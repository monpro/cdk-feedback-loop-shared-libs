import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codeCommit from 'aws-cdk-lib/aws-codecommit';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import {PackageFormat} from "./dependency-sender-stack";
import * as path from "path";


interface DependencyReceiverStackProps extends cdk.StackProps{
  senderAccount: string;
  packageFormat?: PackageFormat;
}

export class DependencyReceiverStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: DependencyReceiverStackProps) {
    super(scope, id, props);

    const { senderAccount = '', packageFormat = 'maven'} = props;

    new events.CfnEventBusPolicy(this, 'DependencyReceiverEventBus', {
      statementId: 'AllowAcrossAccounts',
      action: 'events:PutEvents',
      principal: senderAccount
    })

    const newReleaseRule = new events.Rule(this, 'LibReleaseRule', {
      eventPattern: {
        source: ['aws.codeartifact'],
        detailType: ['CodeArtifact PKG Version Change and Release is made'],
        detail: {
          domainOwner: [this.account],
          packageVersionState: ['Published'],
          packageFormat: [packageFormat]
        }
      }
    })

    const codeCommitRepo = new codeCommit.Repository(this, 'commitRepo', {
      repositoryName: 'ReceiverRepo',
      description: 'including the code & dependencies to share lib'
    })


    new cdk.CfnOutput(this, 'CodeCommitRepoCloneUrl', {
      exportName: 'CodeCommitRepoCloneUrl',
      value: `export CodeCommitRepoCloneURL=${codeCommitRepo.repositoryCloneUrlHttp}`
    });

    const cluster = new ecs.Cluster(this, 'ReceiverCluster', {
      containerInsights: true
    })

    const prCreationTask = new ecs.FargateTaskDefinition(this, 'PullRequestCreatorTask', {
      memoryLimitMiB: 512
    })

    // grant task role with auth
    codeCommitRepo.grantPullPush(prCreationTask.taskRole)
    codeCommitRepo.grant(prCreationTask.taskRole, 'codecommit:CreatePullRequest')

    const container = prCreationTask.addContainer('PullRequestCreatorContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', '..', 'consumer')),
      logging: new ecs.AwsLogDriver({
        streamPrefix: `PullRequestCreatorContainer`,
        logGroup: new logs.LogGroup(this, `PullRequestCreatorContainerLog`, {
          logGroupName: `/PullRequestCreatorContainer/${id}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY
        })
      })
    })

    const taskLambda = new lambda.Function(this, 'RunECSTaskLambda', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../consumer/lambda-handler')),
      environment: {
        TASK_DEFINITION_ARN: prCreationTask.taskDefinitionArn,
        CLUSTER_ARN: cluster.clusterArn,
        TASK_SUBNETS: cluster.vpc.privateSubnets.map(subnet => subnet.subnetId).join(),
        REPO_URL: codeCommitRepo.repositoryCloneUrlHttp,
        REPO_NAME: codeCommitRepo.repositoryName,
        REPO_REGION: this.region,
        CONTAINER_NAME: container.containerName
      }
    })

    if (taskLambda.role && prCreationTask.executionRole) {
        taskLambda.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'))
        taskLambda.role.attachInlinePolicy(new iam.Policy(this, 'AllowECSRun', {
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowECSTaskRun',
              effect: iam.Effect.ALLOW,
              actions: ['ecs:RunTask'],
              resources: [prCreationTask.taskDefinitionArn]
            })
          ]
        }))
        taskLambda.role.attachInlinePolicy(new iam.Policy(this, 'AllowLambdaPassRole', {
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowLambdaPassExecutionRule',
              effect: iam.Effect.ALLOW,
              actions: ['iam:PassRole'],
              resources: [prCreationTask.taskRole.roleArn, prCreationTask.executionRole.roleArn]
            })
          ]
        }))
      codeCommitRepo.grantPullPush(taskLambda.role)
    }



  }
}
