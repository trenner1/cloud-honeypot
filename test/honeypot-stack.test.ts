import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { AwsSolutionsChecks } from 'cdk-nag';
import { HoneypotStack } from '../lib/honeypot-stack';

function synthStack(): { stack: HoneypotStack; template: Template } {
  const app = new cdk.App();
  const stack = new HoneypotStack(app, 'TestHoneypot', {
    env: { account: '123456789012', region: 'us-east-1' },
    machineImage: ec2.MachineImage.genericLinux({
      'us-east-1': 'ami-0123456789abcdef0',
    }),
    adminCidr: '203.0.113.10/32',
  });
  return { stack, template: Template.fromStack(stack) };
}

test('creates an internet-facing sensor VPC without NAT', () => {
  const { template } = synthStack();

  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.40.0.0/16',
  });
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
  template.resourceCountIs('AWS::EC2::InternetGateway', 1);
});

test('opens the sensor security group to all IPv4 traffic', () => {
  const { template } = synthStack();

  template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
    CidrIp: '0.0.0.0/0',
    IpProtocol: '-1',
  });
});

test('launches a t3.small with encrypted disk and IMDSv2', () => {
  const { template } = synthStack();

  template.hasResourceProperties('AWS::EC2::Instance', {
    InstanceType: 't3.small',
    BlockDeviceMappings: Match.arrayWith([
      Match.objectLike({
        DeviceName: '/dev/sda1',
        Ebs: Match.objectLike({
          Encrypted: true,
          VolumeSize: 20,
          VolumeType: 'gp3',
        }),
      }),
    ]),
  });
  template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
    LaunchTemplateData: Match.objectLike({
      MetadataOptions: Match.objectLike({
        HttpTokens: 'required',
      }),
    }),
  });
});

test('stores ISC credentials in Secrets Manager from NoEcho parameters', () => {
  const { template } = synthStack();

  template.hasParameter('DshieldEmail', { NoEcho: true });
  template.hasParameter('DshieldUserid', { NoEcho: true });
  template.hasParameter('DshieldApikey', { NoEcho: true });
  template.hasResourceProperties('AWS::SecretsManager::Secret', {
    Name: 'dshield/credentials',
  });
});

function renderedUserData(template: Template): string {
  const instances = template.findResources('AWS::EC2::Instance');
  const instance = Object.values(instances)[0] as {
    Properties: { UserData: { 'Fn::Base64': { 'Fn::Join': [string, unknown[]] } } };
  };
  const pieces = instance.Properties.UserData['Fn::Base64']['Fn::Join'][1];
  return pieces.map((piece) => (typeof piece === 'string' ? piece : '')).join('');
}

test('user-data re-execs under bash so Ubuntu cloud-init dash does not die on pipefail', () => {
  const { template } = synthStack();
  const rendered = renderedUserData(template);
  expect(rendered).toContain('exec /bin/bash "$0" "$@"');
  expect(rendered).toContain('set -Eeuo pipefail');
});

test('user-data contains no CRLF so Windows git checkouts do not corrupt the Linux script', () => {
  const { template } = synthStack();
  const rendered = renderedUserData(template);
  expect(rendered).not.toContain('\r\n');
  expect(rendered).not.toContain('\r');
});

test('assigns an Elastic IP and emits admin outputs', () => {
  const { template } = synthStack();

  template.resourceCountIs('AWS::EC2::EIP', 1);
  template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
  template.hasOutput('InstanceId', {});
  template.hasOutput('PublicIp', {});
  template.hasOutput('SessionManagerCommand', {});
  template.hasOutput('StatusCommand', {});
});

test('resolves Ubuntu 24.04 AMI from SSM at deploy time', () => {
  const app = new cdk.App();
  const stack = new HoneypotStack(app, 'AmiHoneypot', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.hasParameter('UbuntuAmi', {
    Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
    Default: '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
  });
});

test('cdk-nag AwsSolutionsChecks has no unsuppressed errors', () => {
  const app = new cdk.App();
  const stack = new HoneypotStack(app, 'NagHoneypot', {
    env: { account: '123456789012', region: 'us-east-1' },
    machineImage: ec2.MachineImage.genericLinux({
      'us-east-1': 'ami-0123456789abcdef0',
    }),
  });
  cdk.Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));

  const errors = Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-'));
  expect(errors).toHaveLength(0);
});
