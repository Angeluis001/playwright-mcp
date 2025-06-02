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

import { createConnection } from './connection.js';
import { contextFactory } from './browserContextFactory.js';
import express from 'express';
import type { Request, Response } from 'express';

import type { FullConfig } from './config.js';
import type { Connection } from './connection.js';
import { Transport } from '@modelcontextprotocol/sdk';
import type { BrowserContextFactory } from './browserContextFactory.js';

export class Server {
  readonly config: FullConfig;
  private _connectionList: Connection[] = [];
  private _browserConfig: FullConfig['browser'];
  private _contextFactory: BrowserContextFactory;
  private _httpServer: express.Application = express();
  private _port: number;

  constructor(config: FullConfig) {
    this.config = config;
    this._browserConfig = config.browser;
    this._contextFactory = contextFactory(this._browserConfig);
    this._port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    this._setupHttpServer();
  }

  private _setupHttpServer() {    
    this._httpServer.get('/', (_req: Request, res: Response) => {
      res.json({ status: 'Playwright MCP Server is running' });
    });

    this._httpServer.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'healthy', connections: this._connectionList.length });
    });

    this._httpServer.listen(this._port, () => {
      console.log(`Server is running on port ${this._port}`);
    });
  }

  async createConnection(transport: Transport): Promise<Connection> {
    const connection = createConnection(this.config, this._contextFactory);
    this._connectionList.push(connection);
    await connection.server.connect(transport);
    return connection;
  }

  setupExitWatchdog() {
    let isExiting = false;
    const handleExit = async () => {
      if (isExiting)
        return;
      isExiting = true;
      setTimeout(() => process.exit(0), 15000);
      await Promise.all(this._connectionList.map(connection => connection.close()));
      if (this._httpServer) {
        const server = this._httpServer.listen().close();
        server.close();
      }
      process.exit(0);
    };

    process.stdin.on('close', handleExit);
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
  }
}
