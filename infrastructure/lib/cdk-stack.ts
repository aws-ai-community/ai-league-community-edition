import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as path from 'path';
import { execSync } from 'child_process';
import { Construct } from 'constructs';
import { copyDirRecursive } from './utils';

export class CdkStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool with password policy and self-sign-up disabled
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'ai-league-community-user-pool',
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // User Pool App Client with SRP auth flow and no client secret
    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: 'ai-league-community-app-client',
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
    });

    // Admin group in the User Pool
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator group with full access',
    });

    // DynamoDB UserProfiles table
    const userProfilesTable = new dynamodb.Table(this, 'UserProfilesTable', {
      tableName: 'ai-league-community-user-profiles',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB Maps table
    const mapsTable = new dynamodb.Table(this, 'MapsTable', {
      tableName: 'ai-league-community-maps',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'mapId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Profile API Lambda function (TypeScript bundled with esbuild)
    const profileLambda = new lambdaNodejs.NodejsFunction(this, 'ProfileApiLambda', {
      functionName: 'ai-league-community-profile-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/profile-api/index.ts'),
      handler: 'handler',
      environment: {
        USER_PROFILES_TABLE: userProfilesTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant Profile Lambda read/write access to the UserProfiles table
    userProfilesTable.grantReadWriteData(profileLambda);

    // API Gateway REST API with stage name 'api'
    // Resources are /v1/profile so full path through CloudFront is /api/v1/profile
    const api = new apigateway.RestApi(this, 'ProfileApi', {
      restApiName: 'ai-league-community-profile-api',
      description: 'API Gateway for AI League Community Edition profile management',
      deploy: true,
      deployOptions: {
        stageName: 'api',
      },
      disableExecuteApiEndpoint: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Suppress the auto-generated API Gateway endpoint output
    // (API is accessed via CloudFront, not directly)
    api.node.tryRemoveChild('Endpoint');

    // Cognito User Pool authorizer for API Gateway
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'ai-league-cognito-authorizer',
    });

    // /v1/profile resource (accessed via CloudFront as /api/v1/profile)
    const v1Resource = api.root.addResource('v1');
    const profileResource = v1Resource.addResource('profile');

    const profileIntegration = new apigateway.LambdaIntegration(profileLambda);

    profileResource.addMethod('GET', profileIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    profileResource.addMethod('PUT', profileIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Maps API Lambda function (TypeScript bundled with esbuild)
    const mapsLambda = new lambdaNodejs.NodejsFunction(this, 'MapsApiLambda', {
      functionName: 'ai-league-community-maps-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/maps-api/index.ts'),
      handler: 'handler',
      environment: {
        MAPS_TABLE: mapsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant Maps Lambda read/write access to the Maps table
    mapsTable.grantReadWriteData(mapsLambda);

    // /v1/maps resource with GET and POST methods
    const mapsResource = v1Resource.addResource('maps');
    const mapsIntegration = new apigateway.LambdaIntegration(mapsLambda);

    mapsResource.addMethod('GET', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapsResource.addMethod('POST', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /v1/maps/{mapId} resource with GET, PUT, DELETE methods
    const mapIdResource = mapsResource.addResource('{mapId}');

    mapIdResource.addMethod('GET', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapIdResource.addMethod('PUT', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapIdResource.addMethod('DELETE', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // S3 bucket for frontend static assets (block all public access)
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Origin Access Identity for S3 bucket access
    const originAccessIdentity = new cf.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for AI League Community Edition frontend',
    });

    // Grant CloudFront OAI read access to the S3 bucket
    frontendBucket.grantRead(originAccessIdentity);

    // API Gateway domain for CloudFront custom origin
    const apiDomainName = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    // CloudFront distribution with two origins:
    // 1. Default behavior: S3 for static assets
    // 2. /api/* behavior: API Gateway custom origin
    const distribution = new cf.CloudFrontWebDistribution(this, 'FrontendDistribution', {
      originConfigs: [
        // S3 origin for static assets (default behavior)
        {
          s3OriginSource: {
            s3BucketSource: frontendBucket,
            originAccessIdentity,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          ],
        },
        // API Gateway origin for /api/* path pattern
        {
          customOriginSource: {
            domainName: apiDomainName,
            originProtocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
          },
          behaviors: [
            {
              pathPattern: '/api/*',
              allowedMethods: cf.CloudFrontAllowedMethods.ALL,
              viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              forwardedValues: {
                queryString: true,
                headers: ['Authorization', 'Content-Type'],
              },
              defaultTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              maxTtl: cdk.Duration.seconds(0),
            },
          ],
        },
      ],
      // Custom error responses for SPA routing (serve index.html for 403/404)
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 0,
        },
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 0,
        },
      ],
      defaultRootObject: 'index.html',
    });

    // Build frontend using s3deploy.Source.asset with bundling
    const frontendDir = path.join(__dirname, '../../frontend');

    const frontendAsset = s3deploy.Source.asset(frontendDir, {
      bundling: {
        image: cdk.DockerImage.fromRegistry('node:22-slim'),
        command: [
          'bash', '-c',
          'npm install && npm run build && cp -r dist/* /asset-output/',
        ],
        local: {
          tryBundle(outputDir: string): boolean {
            try {
              execSync('npm install', {
                cwd: frontendDir,
                stdio: 'inherit',
              });
              execSync('npm run build', {
                cwd: frontendDir,
                stdio: 'inherit',
              });
              const distDir = path.join(frontendDir, 'dist');
              copyDirRecursive(distDir, outputDir);
              return true;
            } catch {
              return false;
            }
          },
        },
      },
    });

    // Runtime configuration deployed as aws-exports.json
    const cloudFrontDomain = `https://${distribution.distributionDomainName}`;
    const exportsAsset = s3deploy.Source.jsonData('aws-exports.json', {
      region: this.region,
      Auth: {
        Cognito: {
          userPoolId: this.userPool.userPoolId,
          userPoolClientId: this.userPoolClient.userPoolClientId,
        },
      },
      API: {
        REST: {
          RestApi: {
            endpoint: `${cloudFrontDomain}/api/v1`,
          },
        },
      },
    });

    // Single BucketDeployment with both frontend assets and runtime config
    new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      sources: [frontendAsset, exportsAsset],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Admin Seed Custom Resource Lambda (TypeScript bundled with esbuild)
    const adminSeedLambda = new lambdaNodejs.NodejsFunction(this, 'AdminSeedFunction', {
      functionName: 'ai-league-admin-seed',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/admin-seed/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant the Lambda permissions for Cognito admin operations on the User Pool
    adminSeedLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:CreateGroup',
        ],
        resources: [this.userPool.userPoolArn],
      })
    );

    // CDK Custom Resource that invokes the admin seed Lambda on stack creation
    const adminSeedProvider = new cr.Provider(this, 'AdminSeedProvider', {
      onEventHandler: adminSeedLambda,
    });

    const adminSeedResource = new cdk.CustomResource(this, 'AdminSeedResource', {
      serviceToken: adminSeedProvider.serviceToken,
      properties: {
        UserPoolId: this.userPool.userPoolId,
      },
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'UserInterfaceDomainName', {
      value: cloudFrontDomain,
      description: 'CloudFront Distribution URL for the frontend application',
    });

    new cdk.CfnOutput(this, 'AdminPassword', {
      value: adminSeedResource.getAttString('AdminPassword'),
      description: 'Generated admin password (only set on first deployment when user is created)',
    });
  }
}
