const core = require('@actions/core');
const aws = require('aws-sdk');

const MAX_WAIT_MINUTES = 360;  // 6 hours
const WAIT_DEFAULT_DELAY_SEC = 15;

// Run task in cluster that uses the 'ECS' deployment controller
async function runTask(ecs, clusterName, taskDefArn, taskCount, waitForTask, waitForMinutes, taskOverrides, taskNetworkConfiguration) {
  core.debug('Starting the task');
  let runTaskResponse;
  runTaskResponse = await ecs.runTask({
    cluster: clusterName,
    taskDefinition: taskDefArn,
    count: taskCount,
    overrides: taskOverrides,
    networkConfiguration: taskNetworkConfiguration
  }).promise();

  if (runTaskResponse.failures && runTaskResponse.failures.length > 0) {
    const failure = runTaskResponse.failures[0];
    throw new Error(`${failure.arn} is ${failure.reason}`);
  }

  const taskArns = runTaskResponse.tasks.map(task => {
    let taskIdentity = task.taskArn.split("/").pop();
    core.info(`Task started. Watch this task's progress in the Amazon ECS console: https://console.aws.amazon.com/ecs/home?region=${aws.config.region}#/clusters/${clusterName}/tasks/${taskIdentity}/details`);
    return task.taskArn;
  });
  core.setOutput('task-arn', taskArns);

  // Wait for service stability
  if (waitForTask && waitForTask.toLowerCase() === 'true') {
    await waitForTasksStopped(ecs, clusterName, taskArns, waitForMinutes);
    await tasksExitCode(ecs, clusterName, taskArns);
  } else {
    core.debug('Not waiting for the tasks to finish');
  }
}

async function waitForTasksStopped(ecs, clusterName, taskArns, waitForMinutes) {
  if (waitForMinutes > MAX_WAIT_MINUTES) {
    waitForMinutes = MAX_WAIT_MINUTES;
  }

  const maxAttempts = (waitForMinutes * 60) / WAIT_DEFAULT_DELAY_SEC;
  core.debug('Waiting for tasks to stop');
  const waitTaskResponse = await ecs.waitFor('tasksStopped', {
    cluster: clusterName,
    tasks: taskArns,
    $waiter: {
      delay: WAIT_DEFAULT_DELAY_SEC,
      maxAttempts: maxAttempts
    }
  }).promise();

  core.debug(`Run task response ${JSON.stringify(waitTaskResponse)}`)
  core.info(`All tasks have stopped. Watch progress in the Amazon ECS console: https://console.aws.amazon.com/ecs/home?region=${aws.config.region}#/clusters/${clusterName}/tasks`);
}

async function tasksExitCode(ecs, clusterName, taskArns) {
  const describeResponse = await ecs.describeTasks({
    cluster: clusterName,
    tasks: taskArns
  }).promise();

  const containers = [].concat(...describeResponse.tasks.map(task => task.containers))
  const exitCodes = containers.map(container => container.exitCode)
  const reasons = containers.map(container => container.reason)

  const failuresIdx = [];

  exitCodes.filter((exitCode, index) => {
    if (exitCode !== 0) {
      failuresIdx.push(index)
    }
  })

  const failures = reasons.filter((_, index) => failuresIdx.indexOf(index) !== -1)

  if (failures.length > 0) {
    core.setFailed(failures.join("\n"));
  } else {
    core.info(`All tasks have exited successfully.`);
  }
}

async function run() {
  try {
    const ecs = new aws.ECS({
      customUserAgent: 'amazon-ecs-run-task-definition-for-github-actions'
    });

    // Get inputs
    const taskDefinitionArn = core.getInput('task-definition-arn', { required: true });
    const cluster = core.getInput('cluster', { required: false });
    const taskCount = parseInt(core.getInput('count', { required: false })) || 1;
    const taskOverrides = core.getInput('overrides', { required: false });
    const waitForTask = core.getInput('wait-for-task-completion', { required: false });
    let waitForMinutes = parseInt(core.getInput('wait-for-minutes', { required: false })) || 30;
    if (waitForMinutes > MAX_WAIT_MINUTES) {
      waitForMinutes = MAX_WAIT_MINUTES;
    }

    // Verify taskDefinitionArn is valid
    let registerResponse;
    try {
      registerResponse = await ecs.describeTaskDefinition({
        taskDefinition: taskDefinitionArn
      }).promise();
    } catch (error) {
      core.setFailed("Failed to describe task definition in ECS: " + error.message);
      core.debug(`Task definition arn: ${taskDefinitionArn}`);
      throw(error);
    }

    let taskDefArn = registerResponse.taskDefinition.taskDefinitionArn;
    core.setOutput('task-definition-arn', taskDefArn);

    // Run the task with the task definition
    const clusterName = cluster ? cluster : 'default';
    const overrides = taskOverrides ? JSON.parse(taskOverrides) : {};
    await runTask(ecs, clusterName, taskDefArn, taskCount, waitForTask, waitForMinutes, overrides);
  }
  catch (error) {
    core.setFailed(error.message);
    core.debug(error.stack);
  }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
  run();
}
