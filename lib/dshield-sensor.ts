import * as fs from 'node:fs';
import * as path from 'node:path';
import { Validations } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface DshieldSensorProps {
  readonly vpc: ec2.IVpc;
  readonly credentials: secretsmanager.ISecret;
  readonly logGroup: logs.ILogGroup;
  readonly machineImage: ec2.IMachineImage;
  readonly instanceType?: ec2.InstanceType;
  readonly adminCidr?: string;
}

/**
 * Internet-facing DShield sensor: dedicated public subnet host, SSM admin
 * channel, and unattended ISC installer.
 */
export class DshieldSensor extends Construct {
  public readonly instance: ec2.IInstance;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: DshieldSensorProps) {
    super(scope, id);

    const instanceType = props.instanceType ?? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL);

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'DShield sensor: all inbound IPv4 so ISC can observe internet-wide scans',
      allowAllOutbound: true,
      disableInlineRules: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.allTraffic(),
      'Unsolicited internet traffic is the DShield collection surface',
    );

    this.elasticIp = new ec2.CfnEIP(this, 'ElasticIp', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: 'dshield-sensor' }],
    });

    const instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType,
      machineImage: props.machineImage,
      securityGroup,
      associatePublicIpAddress: true,
      requireImdsv2: true,
      detailedMonitoring: false,
      ssmSessionPermissions: true,
      userDataCausesReplacement: true,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });
    this.instance = instance;

    props.credentials.grantRead(instance.role);
    props.logGroup.grantWrite(instance.role);
    instance.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));

    const bootstrap = fs.readFileSync(path.join(__dirname, 'bootstrap.sh'), 'utf8').replace(/^#![^\n]*\n/, '');

    instance.userData.addCommands(
      `export DSHIELD_SECRET_ARN='${props.credentials.secretArn}'`,
      `export EXPECTED_PUBLIC_IP='${this.elasticIp.attrPublicIp}'`,
      `export LOG_GROUP_NAME='${props.logGroup.logGroupName}'`,
      `export VPC_CIDR='${props.vpc.vpcCidrBlock}'`,
      `export ADMIN_CIDR='${props.adminCidr ?? ''}'`,
      bootstrap,
    );

    new ec2.CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: this.elasticIp.attrAllocationId,
      instanceId: instance.instanceId,
    });

    const openIngress = securityGroup.node.findChild('from 0.0.0.0_0:ALL TRAFFIC');
    Validations.of(openIngress).acknowledge({
      id: 'CloudFormation-Validate::W2508',
      reason: 'Wide-open IPv4 ingress is the DShield collection surface, not an accidental database exposure.',
    });
    Validations.of(instance).acknowledge({
      id: 'CloudFormation-Validate::W9010',
      reason: 'Tests inject a placeholder AMI; deploys resolve Ubuntu 24.04 from Canonical SSM parameters.',
    });
    NagSuppressions.addResourceSuppressions(
      securityGroup,
      [
        {
          id: 'AwsSolutions-EC23',
          reason:
            'A DShield sensor must accept unsolicited internet traffic on all ports; host nftables still limits the admin SSH port.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      instance,
      [
        {
          id: 'AwsSolutions-EC28',
          reason: 'Detailed monitoring is omitted to keep the sensor cheap; ISC telemetry is the primary signal.',
        },
        {
          id: 'AwsSolutions-EC29',
          reason: 'API termination protection is off so cdk destroy can tear down a lab sensor.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      instance.role,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AmazonSSMManagedInstanceCore and CloudWatchAgentServerPolicy are the supported admin/logging attachments for a sensor host.',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'SSM and CloudWatch agent managed policies include wildcards required by those agents.',
        },
      ],
      true,
    );
  }
}
