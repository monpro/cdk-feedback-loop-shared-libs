import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as codeArtifact from 'aws-cdk-lib/aws-codeartifact';

interface DependencySenderStackProps extends cdk.StackProps{
  receiverAccount: string
}

export class DependencySenderStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: DependencySenderStackProps ) {
    super(scope, id, props);

    const receiverAccount = props?.receiverAccount;

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
  }
}
