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

// OpenAI strict mode requires every property key to appear in the `required` array.
// Some Playwright builds omit optional fields from `required`, causing HTTP 400 errors.
// Fix: for every tool, produce the JSON schema via z.toJSONSchema(), recursively add
// all property keys to `required`, then register the fixed schema as the Zod override
// so the MCP server returns the corrected schema to clients.
try {
  const { z } = require('playwright-core/lib/utilsBundle');
  // Mutates jsonSchema in place, adding all property keys to `required`.
  function addAllToRequired(jsonSchema) {
    if (!jsonSchema || typeof jsonSchema !== 'object') return;
    if (jsonSchema.properties) {
      const keys = Object.keys(jsonSchema.properties);
      const req = new Set(Array.isArray(jsonSchema.required) ? jsonSchema.required : []);
      keys.forEach(k => req.add(k));
      jsonSchema.required = Array.from(req);
      keys.forEach(k => addAllToRequired(jsonSchema.properties[k]));
    }
    if (jsonSchema.items) addAllToRequired(jsonSchema.items);
  }
  // tools.browserTools is the standard export; tools.tools may exist in future builds.
  const allTools = [...(tools.browserTools || []), ...(tools.tools || [])];
  for (const tool of allTools) {
    const inputSchema = tool.schema && tool.schema.inputSchema;
    if (!inputSchema || !inputSchema._zod) continue;
    try {
      const fixed = z.toJSONSchema(inputSchema);
      addAllToRequired(fixed);
      inputSchema._zod.toJSONSchema = () => fixed;
    } catch (e) {
      // ignore per-tool failures
    }
  }
} catch (e) {
  // Ignore; best-effort fix for malformed schemas in some Playwright builds.
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
