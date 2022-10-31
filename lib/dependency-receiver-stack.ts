import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as codeCommit from 'aws-cdk-lib/aws-codecommit';
import {PackageFormat} from "./dependency-sender-stack";


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


  }
}
