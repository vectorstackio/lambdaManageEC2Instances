// handler.ts

import type { APIGatewayProxyHandler } from 'aws-lambda'
import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand
} from '@aws-sdk/client-ec2'

const ec2 = new EC2Client({})

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {}
    const { action, instanceId } = body

    if (!action || !instanceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            'action and instanceId are required'
        })
      }
    }

    switch (action) {
    case 'start':
      await ec2.send(
        new StartInstancesCommand({
          InstanceIds: [instanceId]
        })
      )

      break

    case 'stop':
      await ec2.send(
        new StopInstancesCommand({
          InstanceIds: [instanceId]
        })
      )

      break

    case 'reboot':
      await ec2.send(
        new RebootInstancesCommand({
          InstanceIds: [instanceId]
        })
      )

      break

    default:
      return {
        statusCode: 400,
        body: JSON.stringify({error: `Unknown action: ${action}`})
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        action,
        instanceId
      })
    }
  } catch {
    console.error('EC2 lifecycle operation failed')
    return {
      statusCode: 500,
      body: JSON.stringify({error: 'Internal server error in manageEC2Instances'})
    }
  }

}