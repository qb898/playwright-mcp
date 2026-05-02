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
// Some Playwright builds omit optional fields (e.g. `element`) from `required`, causing
// HTTP 400 "invalid_request_body" errors.
//
// Root cause: the MCP server's tools/list handler calls toMcpTool() which calls
// zod.toJSONSchema(tool.inputSchema).  z.toJSONSchema is a non-configurable getter in
// utilsBundle and cannot be monkey-patched.  Instead, we wrap
// Server.prototype.setRequestHandler so that the tools/list response is post-processed
// to add every property key to `required` before the schema reaches the client.
try {
  const { Server } = require('playwright-core/lib/utilsBundle');
  // Mutates a JSON Schema object in place: every key in `properties` is added to
  // `required`, recursively, so OpenAI strict mode accepts the schema.
  // Also removes keywords not permitted by OpenAI (e.g. `propertyNames`).
  function addAllToRequired(jsonSchema) {
    if (!jsonSchema || typeof jsonSchema !== 'object') return;
    // OpenAI does not support `propertyNames`; remove it.
    // (JSON object keys are always strings, so constraining them to `type: string`
    // is a no-op semantically – `additionalProperties` is retained for value typing.)
    delete jsonSchema.propertyNames;
    if (jsonSchema.properties) {
      const keys = Object.keys(jsonSchema.properties);
      const req = new Set(Array.isArray(jsonSchema.required) ? jsonSchema.required : []);
      keys.forEach(k => req.add(k));
      jsonSchema.required = Array.from(req);
      keys.forEach(k => addAllToRequired(jsonSchema.properties[k]));
    }
    if (jsonSchema.additionalProperties && typeof jsonSchema.additionalProperties === 'object') {
      addAllToRequired(jsonSchema.additionalProperties);
    }
    if (jsonSchema.items) {
      if (Array.isArray(jsonSchema.items)) {
        jsonSchema.items.forEach(addAllToRequired);
      } else {
        addAllToRequired(jsonSchema.items);
      }
    }
  }
  // Wrap setRequestHandler so that any handler returning a `tools` array has its
  // inputSchema objects fixed before being sent to clients.
  const origSetRequestHandler = Server.prototype.setRequestHandler;
  Server.prototype.setRequestHandler = function(schema, handler) {
    const wrappedHandler = async (...args) => {
      const result = await handler(...args);
      if (result && Array.isArray(result.tools)) {
        for (const tool of result.tools) {
          if (tool.inputSchema && typeof tool.inputSchema === 'object') {
            addAllToRequired(tool.inputSchema);
          }
        }
      }
      return result;
    };
    return origSetRequestHandler.call(this, schema, wrappedHandler);
  };
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
