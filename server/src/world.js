import { performance } from 'perf_hooks';
import { World as World$1 } from 'ecsy';
import { Vector3 } from 'three';

import logger from './utils/logger';
import Utils from '../../shared/utils';
import Messages from '../../shared/messages';
import { Connection } from '../../shared/components/connection';
import { Playing } from '../../shared/components/playing';
import { Transform } from '../../shared/components/transform';
import { NetworkEventSystem } from './systems/network-event-system';
import { NetworkMessageSystem } from '../../shared/systems/network-message-system';

export default class World {
  constructor(id, maxPlayers, server) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.server = server;
    this.updatesPerSecond = 10;
    this.lastTime = performance.now();

    this.players = {};

    this.playerCount = 0;

    this.world = new World$1()
      .registerComponent(Connection)
      .registerComponent(Playing)
      .registerComponent(Transform)
      .registerSystem(NetworkEventSystem, this)
      .registerSystem(NetworkMessageSystem);

    this.size = new Vector3(10, 10, 10);
    
    logger.info(`${this.id} running`);
  }
  
  run() {
    setTimeout(this.run.bind(this), 1000/this.updatesPerSecond);

    const time = performance.now();
    let delta = time - this.lastTime;

    if (delta > 250) {
      delta = 250;
    }

    this.world.execute(delta, time);
    
    this.lastTime = time;
  }

  handlePlayerConnect(connection) {
    logger.debug(`Creating player ${connection.id}`);
    this.players[connection.id] = this.world
      .createEntity(connection.id)
      .addComponent(Connection, { value: connection });
    this.playerCount++;
    
    connection.onDisconnect(() => {
      this.handlePlayerDisconnect(connection);
    });
    
    connection.pushMessage(new Messages.Go());
  }
  
  handlePlayerDisconnect(connection) {
    logger.debug(`Deleting player ${connection.id}`);
    this.players[connection.id].remove();
    delete this.players[connection.id];
    this.playerCount--;
    this.broadcast(new Messages.Despawn(connection.id));
  }

  addPlayer(id) {
    this.players[id]
      .addComponent(Playing)
      .addComponent(Transform, {
        position: this.getRandomPosition(), 
        rotation: Utils.getRandomRotation()
      });
  }

  getRandomPosition() {
    return new Vector3(
      Utils.random(this.size.x + 1) - this.size.x/2,
      Utils.random(this.size.y + 1) - this.size.y/2,
      Utils.random(this.size.z + 1) - this.size.z/2
    );
  }

  broadcast(message, ignoredPlayerId = null) {
    for (const [id, entity] of Object.entries(this.players)) {
      if (id == ignoredPlayerId) {
        continue;
      }
      
      const connection = entity.getComponent(Connection).value;
      connection.pushMessage(message);
    }
  }
}
