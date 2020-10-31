const run = require('.');
const core = require('@actions/core');

jest.mock('@actions/core');

const mockEcsRunTask = jest.fn();
const mockEcsDescribeTaskDefinition = jest.fn();
const mockEcsDescribeTasks = jest.fn();
const mockEcsWaiter = jest.fn();
jest.mock('aws-sdk', () => {
    return {
        config: {
            region: 'fake-region'
        },
        ECS: jest.fn(() => ({
            describeTaskDefinition: mockEcsDescribeTaskDefinition,
            describeTasks: mockEcsDescribeTasks,
            runTask: mockEcsRunTask,
            waitFor: mockEcsWaiter
        })),
    };
});

describe('Deploy to ECS', () => {

    beforeEach(() => {
        jest.clearAllMocks();

        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition-arn')  // task-definition-arn
            .mockReturnValueOnce('cluster-789')          // cluster
            .mockReturnValueOnce('1');                   // count

        process.env = Object.assign(process.env, { GITHUB_WORKSPACE: __dirname });

        mockEcsDescribeTaskDefinition.mockImplementation(() => {
          return {
            promise() {
              return Promise.resolve({
                taskDefinition: {
                  taskDefinitionArn: "task:def:arn"
                }
              });
            }
          };
        });

        mockEcsDescribeTasks.mockImplementation(() => {
          return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        tasks: [
                            {
                                containers: [
                                    {
                                        lastStatus: "RUNNING",
                                        exitCode: 0,
                                        reason: '',
                                        taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                    }
                                ],
                                desiredStatus: "RUNNING",
                                lastStatus: "RUNNING",
                                taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                            }
                        ]
                    });
                }
            };
        });


        mockEcsRunTask.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        tasks: [
                            {
                                containers: [
                                    {
                                        lastStatus: "RUNNING",
                                        exitCode: 0,
                                        reason: '',
                                        taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                    }
                                ],
                                desiredStatus: "RUNNING",
                                lastStatus: "RUNNING",
                                taskArn: "arn:aws:ecs:fake-region:account_id:task/arn"
                                // taskDefinitionArn: "arn:aws:ecs:<region>:<aws_account_id>:task-definition/amazon-ecs-sample:1"
                            }
                         ]
                    });
                }
            };
        });

        mockEcsWaiter.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });
    });

    test('registers the task definition contents and runs the task', async () => {
        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
        expect(mockEcsRunTask).toHaveBeenNthCalledWith(1, {
            cluster: 'cluster-789',
            taskDefinition: 'task:def:arn',
            count: 1,
            overrides: {}
        });
        expect(mockEcsWaiter).toHaveBeenCalledTimes(0);
        expect(core.setOutput).toBeCalledWith('task-arn', ['arn:aws:ecs:fake-region:account_id:task/arn']);
    });

    test('registers the task definition contents and waits for tasks to finish successfully', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition-arn')                       // task-definition
            .mockReturnValueOnce('cluster-789')                               // cluster
            .mockReturnValueOnce('1')                                         // count
            .mockReturnValueOnce("")                                          // override
            .mockReturnValueOnce('true');                                     // wait-for-finish

        await run();

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
        expect(mockEcsWaiter).toHaveBeenCalledTimes(1);
        expect(core.info).toBeCalledWith("All tasks have exited successfully.");
    });

    test('defaults to the default cluster', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition-arn'); // task-definition

        await run();

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
        expect(mockEcsRunTask).toHaveBeenNthCalledWith(1, {
            cluster: 'default',
            taskDefinition: 'task:def:arn',
            count: 1,
            overrides: {}
        });
    });

    test('error is caught if task def registration fails', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition-arn'); // task-definition

        mockEcsDescribeTaskDefinition.mockImplementation(() => {
            throw new Error("Could not parse");
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(2);
        expect(core.setFailed).toHaveBeenNthCalledWith(1, 'Failed to describe task definition in ECS: Could not parse');
        expect(core.setFailed).toHaveBeenNthCalledWith(2, 'Could not parse');
    });
});
