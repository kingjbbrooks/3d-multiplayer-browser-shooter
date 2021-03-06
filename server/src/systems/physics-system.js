const path = require('path');
import { System } from 'ecsy';
import { Vector3, Quaternion, LoadingManager } from 'three';

import Types from '../../../shared/types';
import { Transform } from '../components/transform';
import { RigidBody } from '../components/rigidbody';
import { AssetManager } from '../asset-manager';
import { Kind } from '../../../shared/components/kind';

let quaternion = new Quaternion();

export class PhysicsSystem extends System {
  static queries = {
    entities: {
      components: [Transform, RigidBody, Kind],
      listen: {
        added: true,
        removed: true
      }
    },
  };

  init({ worldServer, ammo }) {
    this.worldServer = worldServer;
    this.epsilon = 10e-6;
    this.collisions = new Map();
    this.collisionKeys = [];
    this.frame = 0;

    this.ammo = ammo;
    this.physicsWorld = this.createWorld();
    this.transform = new this.ammo.btTransform();
    this.quaternion = new this.ammo.btQuaternion(0, 0, 0, 1);
    this.vector3 = new this.ammo.btVector3(0, 0, 0);
    this.threeVector3 = new Vector3();

    this.bodyToEntity = new Map();

    const loadingManager = new LoadingManager();
    loadingManager.onLoad = this.handleLoad.bind(this);

    this.assetManager = new AssetManager(loadingManager);
    this.assetManager.loadModel({
      name: 'spaceship',
      url: path.join(__dirname, '../../../client/public/models/spaceship.gltf')
    });
    this.assetManager.loadModel({
      name: 'asteroid',
      url: path.join(__dirname, '../../../client/public/models/asteroid.gltf')
    });

    this.stop();
  }

  handleLoad() {
    this.play();
    this.worldServer.spawnAsteroids(100);
  }

  execute(delta) {
    this.frame++;

    this.queries.entities.added.forEach((entity) => {
      const kind = entity.getComponent(Kind).value;
      let modelName = 'spaceship';

      switch(kind) {
        case Types.Entities.SPACESHIP:
          modelName = 'spaceship';
          break;
        case Types.Entities.ASTEROID:
          modelName = 'asteroid';
          break;
      }

      const body = this.setupRigidBody(this.createRigidBody(entity, modelName), entity);

      body.setCcdMotionThreshold(0.01);
      body.setCcdSweptSphereRadius(0.01);

      entity.body = body;
      this.physicsWorld.addRigidBody(body);
    });

    this.physicsWorld.stepSimulation(delta, 4, delta);

    this.queries.entities.results.forEach((entity) => {
      const rigidBody = entity.getComponent(RigidBody);

      if (rigidBody.weight === 0) {
        return;
      }

      const body = entity.body;
      const velocity = rigidBody.velocity;
      const angularVelocity = rigidBody.angularVelocity;

      const vec = this.vector3;
      vec.setX(velocity.x);
      vec.setY(velocity.y);
      vec.setZ(velocity.z);

      body.applyCentralLocalForce(vec);

      vec.setX(angularVelocity.x);
      vec.setY(angularVelocity.y);
      vec.setZ(angularVelocity.z);

      body.applyLocalTorque(vec);

      if (rigidBody.kinematic) {
        const motionState = body.getMotionState();

        if (motionState) {
          const transformComponent = entity.getComponent(Transform);
          const velocity = this.threeVector3
            .copy(rigidBody.velocity)
            .applyQuaternion(transformComponent.rotation);

          const vec = this.vector3;
          vec.setX(transformComponent.position.x + velocity.x * delta);
          vec.setY(transformComponent.position.y + velocity.y * delta);
          vec.setZ(transformComponent.position.z + velocity.z * delta);

          const q = this.quaternion;
          q.setValue(
            transformComponent.rotation.x,
            transformComponent.rotation.y,
            transformComponent.rotation.z,
            transformComponent.rotation.w
          );

          const transform = this.transform;
          transform.setIdentity();
          transform.setOrigin(vec);
          transform.setRotation(q);

          motionState.setWorldTransform(transform);
        }
      }

      if (body.isActive() && body.getMotionState()) {
        const transform = this.transform;
        const q = this.quaternion;

        body.getMotionState().getWorldTransform(transform);
        const o = transform.getOrigin();
        transform.getBasis().getRotation(q);

        let transformComponent = entity.getMutableComponent(Transform);
        transformComponent.position.set(o.x(), o.y(), o.z());
        transformComponent.rotation.set(q.x(), q.y(), q.z(), q.w());
      }
    });
  }

  createWorld() {
    const config = new this.ammo.btDefaultCollisionConfiguration();
    this.dispatcher = new this.ammo.btCollisionDispatcher(config);
    const cache = new this.ammo.btDbvtBroadphase();
    const solver = new this.ammo.btSequentialImpulseConstraintSolver();
    const world = new this.ammo.btDiscreteDynamicsWorld(
      this.dispatcher,
      cache,
      solver,
      config
    );
    world.setGravity(new this.ammo.btVector3(0, 0, 0));

    return world;
  }

  createRigidBody(entity, modelName) {
    const rigidBody = entity.getComponent(RigidBody);
    const transform = entity.getComponent(Transform);

    const shape = this.createConcaveShape(this.assetManager.getTriangles(
      modelName,
      transform.scale
    ));
    const localInertia = new this.ammo.btVector3(1, 1, 1);
    shape.calculateLocalInertia(rigidBody.weight, localInertia);
    const form = new this.ammo.btTransform();
    form.setIdentity();
    form.setOrigin(
      new this.ammo.btVector3(
        transform.position.x,
        transform.position.y,
        transform.position.z
      )
    );

    quaternion.copy(transform.rotation);

    form.setRotation(
      new this.ammo.btQuaternion(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
      )
    );

    const state = new this.ammo.btDefaultMotionState(form);
    const info = new this.ammo.btRigidBodyConstructionInfo(
      rigidBody.weight,
      state,
      shape,
      localInertia
    );

    const body = new this.ammo.btRigidBody(info);
    this.bodyToEntity.set(this.ammo.getPointer(body), entity);

    return body;
  }

  setupRigidBody(body, entity) {
    const rigidBody = entity.getComponent(RigidBody);
    const velocity = rigidBody.velocity;
    const angularVelocity = rigidBody.angularVelocity;

    body.setRestitution(0);
    body.setFriction(0);
    body.setDamping(rigidBody.damping, rigidBody.angularDamping);
    body.setSleepingThresholds(0, 0);
    body.setLinearVelocity(
      new this.ammo.btVector3(velocity.x, velocity.y, velocity.z)
    );
    body.setAngularVelocity(
      new this.ammo.btVector3(angularVelocity.x, angularVelocity.y, angularVelocity.z)
    );

    if (rigidBody.kinematic && body.setCollisionFlags && body.getCollisionFlags) {
      const CF_NO_CONTACT_RESPONSE = 4;
      const CF_KINEMATIC_OBJECT= 2;
      const DISABLE_DEACTIVATION = 4;

      body.setCollisionFlags(
        body.getCollisionFlags() |
        CF_NO_CONTACT_RESPONSE |
        CF_KINEMATIC_OBJECT
      );
      body.setActivationState(DISABLE_DEACTIVATION);
    }

    return body;
  }

  createConcaveShape(triangles) {
    const convexHullShape = new this.ammo.btConvexHullShape();
    const vec1 = new this.ammo.btVector3();
    const vec2 = new this.ammo.btVector3();
    const vec3 = new this.ammo.btVector3();

    for (const triangle of triangles) {
      vec1.setX(triangle[0].x);
      vec1.setY(triangle[0].y);
      vec1.setZ(triangle[0].z);
      convexHullShape.addPoint(vec1, true);

      vec2.setX(triangle[1].x);
      vec2.setY(triangle[1].y);
      vec2.setZ(triangle[1].z);
      convexHullShape.addPoint(vec2, true);

      vec3.setX(triangle[2].x);
      vec3.setY(triangle[2].y);
      vec3.setZ(triangle[2].z);
      convexHullShape.addPoint(vec3, true);
    }

    return convexHullShape;
  }
}
