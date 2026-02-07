export interface Config {
  modCliPath: string;
  debug: boolean;
}

export function loadConfig(): Config {
  return {
    modCliPath: process.env.MOD_CLI_PATH || 'mod',
    debug: process.env.DEBUG === 'true',
  };
}
