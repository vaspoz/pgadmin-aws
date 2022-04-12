#!/bin/bash

read -p "Enter region [eu-central-1]" region
REGION=${region:-eu-central-1}

read -p "Enter AWS profile to use [default]" profile
AWSPROFILE=${profile:-default}

echo "Installing node modules..."
npm install

echo "Installing cdktf modules/providers..."
cdktf get

npm run deploy
