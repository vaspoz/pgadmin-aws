#!/bin/bash

read -p "Enter region [eu-central-1]" region
REGION=${region:-eu-central-1}

read -p "Enter AWS profile to use [default]" profile
AWSPROFILE=${profile:-default}

npm run deploy
