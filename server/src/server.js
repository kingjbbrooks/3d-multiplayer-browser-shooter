import { performance } from 'perf_hooks';
import { World } from 'ecsy';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

import logger from './utils/logger';

import { Connection } from './components/connection';

export class Server {
  constructor() {
    this.updatesPerSecond = 10;
    this.lastTime = performance.now();

    this.worlds = [];
    this.worlds.push(new World());
    this.worlds.push(new World());
    
    this.init();
  }

  init() {
    const port = +process.env.PORT || 1337;
    const wss = new WebSocket.Server({ port });
    logger.info(`Listening on port ${ port }`);
    
    wss.on('connection', this.handleConnect.bind(this));
    
    for (const world of this.worlds) {
      world.registerComponent(Connection);
    }
  }

  run() {
    let time = performance.now();
    let delta = time - this.lastTime;

    if (delta > 250) {
      delta = 250;
    }

    for (const world of this.worlds) {
      world.execute(delta, time);
    }
    
    this.lastTime = time;

    setTimeout(this.run.bind(this), 1000/this.updatesPerSecond);
  }
  
  handleConnect(ws) {
    logger.info('New connection');

    let hasEnteredWorld = false;
    
    for (const [index, world] of this.worlds.entries()) {
      const connections = world.componentsManager.getComponentsPool(Connection).count;

      if (connections < process.env.PLAYERS_PER_WORLD) {
        const id = uuidv4();
        
        world.createEntity().addComponent(Connection, {
          id: uuidv4(),
          connection: ws
        });

        hasEnteredWorld = true;
        
        logger.info(`Player ${id} entered world ${index}`);

        break;
      }
    }

    if (!hasEnteredWorld) {
      ws.close();

      logger.info('Worlds are full; closing connection');
    }
  }
}

