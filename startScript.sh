#!/bin/bash

read -p "Enter region [eu-central-1]" region
REGION=${region:-eu-central-1}

read -p "Enter AWS profile to use [default]" profile
AWSPROFILE=${profile:-default}


# install nodejs
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install node
node -e "console.log('Running Node.js ' + process.version)"
