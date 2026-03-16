import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

interface DatabaseStackV2Props extends cdk.StackProps {
  appName: string;
  stage: string;
}

/**
 * V2 - Single-table design pattern para DynamoDB.
 *
 * Access Patterns:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ Entity    │ PK                    │ SK                          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Customer  │ CUSTOMER#{id}         │ METADATA                    │
 * │ User      │ USER#{id}             │ METADATA                    │
 * │ Webform   │ WEBFORM#{id}          │ METADATA                    │
 * │ Webform   │ CUSTOMER#{customerId} │ WEBFORM#{createdAt}#{id}    │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * GSI1: Listar por tipo + status (GSI1PK = TYPE#STATUS, GSI1SK = createdAt)
 * GSI2: Listar por assignedTo (GSI2PK = USER#{userId}, GSI2SK = createdAt)
 */
export class DatabaseStackV2 extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackV2Props) {
    super(scope, id, props);
    const { appName, stage } = props;

    // ─── Main Table ───────────────────────────────────────────────────────────
    this.table = new dynamodb.Table(this, "MainTable", {
      tableName: `${appName}-${stage}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: stage === "prod",
      removalPolicy:
        stage === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // ─── GSI1: Type + Status index ────────────────────────────────────────────
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─── GSI2: Assigned user index ────────────────────────────────────────────
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
      exportName: `${appName}-${stage}-TableName`,
    });

    new cdk.CfnOutput(this, "TableArn", {
      value: this.table.tableArn,
      exportName: `${appName}-${stage}-TableArn`,
    });
  }
}
