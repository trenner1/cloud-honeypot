# DShield Sensor

A dedicated AWS host that simulates internet services for the SANS Internet Storm Center and submits what it sees.

## Language

**Sensor**:
The EC2 host running the DShield honeypot software. One public IPv4 address, one job.
_Avoid_: Pi, box, agent, node (ambiguous with SSM and CDK)

**Decoy service**:
A simulated listener (Cowrie SSH/Telnet, DShield HTTP) that is not a real login surface.
_Avoid_: service, server, open port (too generic)

**Admin channel**:
How an operator reaches the Sensor after deploy — SSM Session Manager, optionally SSH on port 12222.
_Avoid_: SSH (that port is a decoy after install), bastion

**ISC account**:
The SANS Internet Storm Center identity (email, userid, API key) that authorizes log submission.
_Avoid_: DShield login, API credentials (too vague about which of the three fields)

**Honeypot VPC**:
The isolated public VPC whose only purpose is exposing Sensors to the internet.
_Avoid_: default VPC, shared VPC
