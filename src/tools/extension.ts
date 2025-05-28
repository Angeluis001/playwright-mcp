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

import net from 'node:net';
import { z } from 'zod';
import { defineTool } from './tool.js';
import open, { apps } from 'open';

const kOutputLinesSocketPathForTesting = process.env.OUTPUT_LINES_SOCKET_PATH;
function sendMessageToSocket(message: string) {
  if (!kOutputLinesSocketPathForTesting)
    return;
  const connection = net.createConnection(kOutputLinesSocketPathForTesting, () => {
    connection.write(message);
    connection.end();
  });
}

const extension = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_connect',
    title: 'Connect to a running browser',
    description: 'If the user explicitly asks to connect to a running browser, use this tool to initiate the connection.',
    inputSchema: z.object({}),
    type: 'destructive',
  },
  handle: async context => {
    await context.connectToExtension(async url => {
      if (!kOutputLinesSocketPathForTesting)
        await open(url, { app: { name: apps.chrome } });
      else
        sendMessageToSocket(`open call to: ${url}`);
    });
    return {
      resultOverride: {
        content: [{ type: 'text', text: 'Connection established' }]
      },
      code: [],
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

export default [
  extension,
];
