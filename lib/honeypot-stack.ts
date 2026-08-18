import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { DshieldSensor } from './dshield-sensor';

const UBUNTU_24_AMI_PARAMETER =
  '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id';

class CanonicalUbuntuImage implements ec2.IMachineImage {
  constructor(private readonly imageId: string) {}

  public getImage(scope: Construct): ec2.MachineImageConfig {
    cdk.Stack.of(scope);
    return {
      imageId: this.imageId,
      osType: ec2.OperatingSystemType.LINUX,
      userData: ec2.UserData.forLinux(),
    };
  }
}

export interface HoneypotStackProps extends cdk.StackProps {
  readonly machineImage?: ec2.IMachineImage;
  readonly instanceType?: ec2.InstanceType;
  readonly vpcCidr?: string;
  readonly adminCidr?: string;
}

/** Dedicated VPC, Secrets Manager ISC account, and a single DShield sensor. */
export class HoneypotStack extends cdk.Stack {
  public readonly sensor: DshieldSensor;
  public readonly credentials: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: HoneypotStackProps = {}) {
    super(scope, id, props);

    const email = new cdk.CfnParameter(this, 'DshieldEmail', {
      type: 'String',
      noEcho: true,
      minLength: 3,
      description: 'Email address on the DShield / ISC account',
    });
    const userid = new cdk.CfnParameter(this, 'DshieldUserid', {
      type: 'String',
      noEcho: true,
      minLength: 1,
      description: 'Numeric user id from https://www.dshield.org/myaccount.html',
    });
    const apikey = new cdk.CfnParameter(this, 'DshieldApikey', {
      type: 'String',
      noEcho: true,
      minLength: 8,
      description: 'API key from https://www.dshield.org/myaccount.html',
    });

    this.credentials = new secretsmanager.Secret(this, 'Credentials', {
      description: 'DShield ISC account used by the sensor to submit logs',
      secretName: 'dshield/credentials',
      secretObjectValue: {
        email: cdk.SecretValue.cfnParameter(email),
        userid: cdk.SecretValue.cfnParameter(userid),
        apikey: cdk.SecretValue.cfnParameter(apikey),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr ?? '10.40.0.0/16'),
      maxAzs: 1,
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const logGroup = new logs.LogGroup(this, 'BootstrapLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    let machineImage = props.machineImage;
    if (!machineImage) {
      const ami = new cdk.CfnParameter(this, 'UbuntuAmi', {
        type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
        default: UBUNTU_24_AMI_PARAMETER,
        description: 'Canonical Ubuntu 24.04 LTS AMI (resolved at deploy)',
      });
      machineImage = new CanonicalUbuntuImage(ami.valueAsString);
    }

    this.sensor = new DshieldSensor(this, 'Sensor', {
      vpc,
      credentials: this.credentials,
      logGroup,
      machineImage,
      instanceType: props.instanceType,
      adminCidr: props.adminCidr,
    });

    NagSuppressions.addResourceSuppressions(
      this.credentials,
      [
        {
          id: 'AwsSolutions-SMG4',
          reason: 'The DShield API key is issued by ISC and cannot be rotated by Secrets Manager.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      vpc,
      [
        {
          id: 'AwsSolutions-VPC7',
          reason: 'VPC flow logs on an internet-facing sensor duplicate ISC telemetry and generate high ingest cost.',
        },
      ],
      true,
    );

    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.sensor.instance.instanceId,
      description: 'EC2 instance id for SSM Session Manager',
    });
    new cdk.CfnOutput(this, 'PublicIp', {
      value: this.sensor.elasticIp.attrPublicIp,
      description: 'Elastic IP attackers will scan',
    });
    new cdk.CfnOutput(this, 'SessionManagerCommand', {
      value: `aws ssm start-session --target ${this.sensor.instance.instanceId}`,
      description: 'Admin channel (no inbound SSH required); or npm run ssm',
    });
    new cdk.CfnOutput(this, 'StatusCommand', {
      value: 'sudo /home/dshield/dshield/bin/status.sh',
      description: 'Run on the instance as root after INSTALL_COMPLETE and reboot',
    });
    new cdk.CfnOutput(this, 'CredentialsSecretName', {
      value: this.credentials.secretName,
      description: 'Secrets Manager name holding the ISC account JSON',
    });
  }
}
