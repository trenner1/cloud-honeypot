#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { AwsSolutionsChecks } from 'cdk-nag';
import { HoneypotStack } from '../lib/honeypot-stack';

const app = new cdk.App();

const instanceTypeContext = app.node.tryGetContext('instanceType') as string | undefined;
const adminCidr = app.node.tryGetContext('adminCidr') as string | undefined;
const vpcCidr = app.node.tryGetContext('vpcCidr') as string | undefined;

new HoneypotStack(app, 'DshieldHoneypot', {
  description: 'SANS Internet Storm Center DShield honeypot',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  instanceType: instanceTypeContext ? new ec2.InstanceType(instanceTypeContext) : undefined,
  adminCidr,
  vpcCidr,
  tags: {
    Project: 'dshield-honeypot',
  },
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
