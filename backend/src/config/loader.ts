import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ConfigSchema, type AppConfig } from './schema.js';

function isObject(item: unknown): item is Record<string, unknown> {
  return !!item && typeof item === 'object' && !Array.isArray(item);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(forceReload = false): AppConfig {
  if (cachedConfig && !forceReload) {
    return cachedConfig;
  }

  const env = process.env.NODE_ENV ?? 'development';
  // Config files are located at the root of the backend folder
  // When running via tsx or node, process.cwd() is /Users/yashhwanth/Documents/shamagama/backend
  const configDir = process.cwd();

  const defaultPath = path.join(configDir, 'config.default.yaml');
  if (!fs.existsSync(defaultPath)) {
    throw new Error(`Default configuration file not found at: ${defaultPath}`);
  }

  // 1. Load defaults
  const defaults = yaml.load(fs.readFileSync(defaultPath, 'utf8')) as Record<string, unknown>;

  // 2. Load environment-specific override if it exists
  const envPath = path.join(configDir, `config.${env}.yaml`);
  const overrides = fs.existsSync(envPath)
    ? (yaml.load(fs.readFileSync(envPath, 'utf8')) as Record<string, unknown>)
    : {};

  // 3. Deep merge overrides into defaults
  const merged = deepMerge(defaults, overrides);

  // 4. Validate schema with Zod
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Configuration validation failed');
  }

  // 5. Freeze config object to make it immutable at runtime
  cachedConfig = Object.freeze(result.data);
  return cachedConfig;
}
