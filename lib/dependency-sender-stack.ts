import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as codeArtifact from 'aws-cdk-lib/aws-codeartifact';

export type PackageFormat = 'maven' | 'gradle' | 'npm';

interface DependencySenderStackProps extends cdk.StackProps{
  receiverAccount: string;
  packageFormat?: PackageFormat;
}

export class DependencySenderStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: DependencySenderStackProps ) {
    super(scope, id, props);

    const { receiverAccount = '', packageFormat = 'maven'} = props;

    // allow the receiver account to put events into the eventBus in case a fail build
    new events.CfnEventBusPolicy(this, 'DependencySenderEventBus', {
      statementId: 'AllowAcrossAccounts',
      action: 'events:PutEvents',
      principal: receiverAccount
    })


    // allow the receiver account to read the shared repo
    const codeArtifactDomain = new codeArtifact.CfnDomain(this, 'SharedLibDomain', {
      domainName: 'codeartifact-domain',
      permissionsPolicyDocument: {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Action": [
              "codeartifact:GetAuthorizationToken",
              "codeartifact:ReadFromRepository"
            ],
            "Effect": "Allow",
            "Principal": {
              "AWS": `${receiverAccount}`
            },
            "Resource": "*"
          }
        ]
      }
    })

    const codeArtifactRepo = new codeArtifact.CfnRepository(this, 'SharedLibRepo', {
      repositoryName: 'codeartifact',
      domainName: codeArtifactDomain.domainName
    })

    codeArtifactRepo.addDependsOn(codeArtifactDomain)

    // create a event in receiver account once a new release is made

    const newReleaseRule = new events.Rule(this, 'LibReleaseRule', {
      eventPattern: {
        source: ['aws.codeartifact'],
        detailType: ['CodeArtifact PKG Version Change and Release is made'],
        detail: {
          domainOwner: [this.account],
          domainName: [codeArtifactDomain.domainName],
          repositoryName: [codeArtifactRepo.repositoryName],
          packageVersionState: ['Published'],
          packageFormat: [packageFormat]
        }
      }
    })

    // add target to make the release rule enabled to put events into receiver account's event bus
    newReleaseRule.addTarget(
      new targets.EventBus(
        events.EventBus.fromEventBusArn(
          this,
          'receiverAccountEventBus',
          `arn:aws:events:${this.region}:${receiverAccount}:event-bus/default`,
        ),
      )
    )

    const notificationTopic = new sns.Topic(this, 'StreamBuildTopic', {
      topicName: 'StreamBuildTopic'
    })

    const failedBuildRule = new events.Rule(this, 'FailedBuildRule', {
      eventPattern: {
        detailType: ['Code Build Failed'],
        source: ['aws.codebuild'],
        account: [receiverAccount],
        detail: {
          'build-status': ['FAILED']
        }
      }
    })

    failedBuildRule.addTarget(new targets.SnsTopic(notificationTopic));

    new cdk.CfnOutput(this, 'codeartifact-domain', {
      exportName: 'CodeArtifactDomain',
      value: `export CodeArtifactDomain=${codeArtifactDomain.domainName}`
    })

    new cdk.CfnOutput(this, 'codeartifact-account', {
      exportName: 'CodeArtifactAccount',
      value: `export CodeArtifactAccount=${this.account}`
    })

    new cdk.CfnOutput(this, 'codeartifact-region', {
      exportName: 'CodeArtifactRegion',
      value: `export CodeArtifactRegion=${this.region}`
    })
  }
}
