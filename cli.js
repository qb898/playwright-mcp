/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { program } = require('playwright-core/lib/utilsBundle');
const { tools, libCli } = require('playwright-core/lib/coreBundle');

// Repair schema issue for form-like inputs: ensure items under `fields` include
// a `required` array containing every key in `properties` (some Playwright builds omit it).
// Apply fix generically to any tool that exposes `inputSchema.toJSONSchema` and
// has `properties.fields.items.properties`.
try {
  const allTools = [];
  if (tools.browserTools) allTools.push(...tools.browserTools);
  if (tools.tools) allTools.push(...tools.tools);
  for (const tool of allTools) {
    const schema = tool.schema || tool;
    const inputSchema = (schema.inputSchema || schema.input);
    if (!inputSchema || typeof inputSchema.toJSONSchema !== 'function')
      continue;
    try {
      const js = inputSchema.toJSONSchema();
      if (js && js.properties && js.properties.fields && js.properties.fields.items) {
        const items = js.properties.fields.items;
        if (items.properties) {
          const propKeys = Object.keys(items.properties);
          // Ensure `required` is an array that contains every property key
          items.required = Array.from(new Set([...(Array.isArray(items.required) ? items.required : []), ...propKeys]));
          // Override toJSONSchema to return the fixed schema
          inputSchema.toJSONSchema = () => js;
        }
      }
    } catch (e) {
      // ignore per-tool failures and continue
    }
  }
} catch (e) {
  // Ignore; this is a best-effort runtime fix for malformed schemas in some Playwright builds.
}

if (process.argv.includes('install-browser')) {
  const argv = process.argv.map(arg => arg === 'install-browser' ? 'install' : arg);
  libCli.decorateProgram(program);
  void program.parseAsync(argv);
  return;
}

const packageJSON = require('./package.json');
const p = program.version('Version ' + packageJSON.version).name('Playwright MCP');
tools.decorateMCPCommand(p, packageJSON.version);

void program.parseAsync(process.argv);
