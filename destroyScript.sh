#!/bin/bash

read -p "Enter region [eu-central-1]: " region
export REGION=${region:-eu-central-1}

read -p "Enter AWS profile to use [default]: " profile
export AWSPROFILE=${profile:-default}

echo
echo "Destroying the stack..."

npm run destroy
