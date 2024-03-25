import * as t from "io-ts";
import { isLeft } from "fp-ts/lib/Either.js";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { FindCursor, ObjectId, WithId } from "mongodb";

import { State } from "./globals.js";
import { sceneToJson } from "./scenes.js";
import { makeRequireSuperuserOrRoleMiddleware } from "./permissions.js";

export interface MongoSceneFeature {
  scene_id: ObjectId;
  feature_time: Date;
}

export interface MongoSceneFeatureQueue {
  scene_ids: ObjectId[];
}

export interface HydratedSceneFeature {
  id?: ObjectId;
  scene: Record<string, any>;
  feature_time: Date;
}

const QueueRequestBody = t.type({
  scene_ids: t.array(t.string),
});

/*
 * Right now the feature time is the only thing that it makes sense to update,
 * and there's really no sense having an empty update.
 * But if that changes in the future, this should probably use `t.partial` instead
 */
const FeatureUpdateRequestBody = t.type({
  feature_time: t.number,
});

function timeStrippedDate(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function getFeaturesForDate(state: State, date: Date): Promise<FindCursor<WithId<MongoSceneFeature>>> {
  const day = timeStrippedDate(date);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  return getFeaturesForRange(state, day, nextDay);
}

export async function getFeaturesForRange(state: State, startDate: Date, endDate: Date): Promise<FindCursor<WithId<MongoSceneFeature>>> {
  return state.features.find({
    "$and": [
      { feature_time: { "$gte": startDate } },
      { feature_time: { "$lt": endDate } }
    ]
  });
}

async function hydratedFeature(state: State, feature: WithId<MongoSceneFeature>, req: JwtRequest): Promise<HydratedSceneFeature> {
  const scene = await state.scenes.findOne({ "_id": feature.scene_id });
  if (scene === null) {
    throw new Error(`Database consistency failure, feature ${feature._id} missing scene ${feature.scene_id}`);
  }

  const sceneJson = await sceneToJson(scene, state, req.session);
  return {
    id: feature._id,
    feature_time: feature.feature_time,
    scene: sceneJson
  };
}

/*
 * Note that `findOneAndUpdate` will return (a Promise resolving to) the "original" document, before the pop operation
 * has occurred.
 * See https://mongodb.github.io/node-mongodb-native/6.3/classes/Collection.html#findOneAndUpdate
 * along with
 * https://mongodb.github.io/node-mongodb-native/6.3/interfaces/FindOneAndUpdateOptions.html#returnDocument
 */
export async function tryPopNextQueuedSceneId(state: State): Promise<ObjectId | null> {
  const result = await state.featureQueue.findOneAndUpdate(
    { queue: true },
    { "$pop": { "scene_ids": -1 } }  // -1 pops the first element: https://www.mongodb.com/docs/manual/reference/operator/update/pop/
  );
  const queueDoc = result.value;
  return queueDoc?.scene_ids[0] ?? null;
}

export async function getCurrentFeaturedSceneID(state: State): Promise<ObjectId | null> {
  const features = await getFeaturesForDate(state, new Date());
  const firstFeature = await features.next();
  return firstFeature?.scene_id ?? tryPopNextQueuedSceneId(state);
}

export function initializeFeatureEndpoints(state: State) {
  const FeatureCreation = t.type({
    scene_id: t.string,
    feature_time: t.Integer
  });

  type FeatureCreationT = t.TypeOf<typeof FeatureCreation>;

  const requireManageFeatures = makeRequireSuperuserOrRoleMiddleware(state, 'manage-features');

  state.app.post(
    "/feature",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {

      const maybe = FeatureCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: FeatureCreationT = maybe.right;

      const date = new Date(input.feature_time);
      if (isNaN(date.getTime())) {
        res.status(400).json({
          error: true,
          message: "Invalid date specified",
        });
        return;
      }

      const record: MongoSceneFeature = {
        scene_id: new ObjectId(input.scene_id),
        feature_time: date,
      };

      try {
        const result = await state.features.insertOne(record);

        res.json({
          error: false,
          id: "" + result.insertedId,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  state.app.get(
    "/features",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const startDate = new Date(Number(req.query.start_date));
      const endDate = new Date(Number(req.query.end_date));

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({
          error: true,
          message: "Invalid start and end date formats"
        });
        return;
      }

      const features = await getFeaturesForRange(state, startDate, endDate);
      const hydratedFeatures: HydratedSceneFeature[] = [];
      for await (const feature of features) {
        const hydrated = await hydratedFeature(state, feature, req);
        hydratedFeatures.push(hydrated);
      }

      res.json({
        error: false,
        features: hydratedFeatures
      });
    });

  state.app.get(
    "/features/queue",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const queueDoc = await state.featureQueue.findOne();
      const sceneIDs = queueDoc?.scene_ids ?? [];
      const scenes: Record<string, any>[] = [];
      for (const id of sceneIDs) {
        const scene = await state.scenes.findOne({ "_id": new ObjectId(id) });
        if (scene === null) {
          throw new Error(`Database consistency failure, feature queue missing scene ${id}`);
        }
        const sceneJson = await sceneToJson(scene, state, req.session);
        scenes.push(sceneJson);
      }

      res.json({
        error: false,
        scenes
      });

    });

  state.app.get(
    "/features/:id",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const objectId = new ObjectId(req.params.id);
      const feature = await state.features.findOne({ _id: objectId });
      if (feature === null) {
        res.status(404).json({
          error: true,
          message: `Feature with id ${req.params.id} not found`
        });
        return;
      }

      const hydrated = await hydratedFeature(state, feature, req);
      res.json({
        error: false,
        feature: hydrated
      });

    });

  state.app.patch(
    "/features/:id",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const objectId = new ObjectId(req.params.id);
      const feature = await state.features.findOne({ _id: objectId });
      if (feature === null) {
        res.status(404).json({
          error: true,
          message: `Feature with id ${req.params.id} not found`
        });
        return;
      }

      const maybe = FeatureUpdateRequestBody.decode(req.body);
      if (isLeft(maybe)) {
        res.status(400).json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const update = { feature_time: new Date(maybe.right.feature_time) };
      try {
        const result = await state.features.updateOne({ _id: objectId }, { "$set": update });
        res.json({
          error: false,
          updated: result.modifiedCount === 1
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
  });

  state.app.delete(
    "/features/:id",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const objectId = new ObjectId(req.params.id);
      const feature = await state.features.findOne({ _id: objectId });
      if (feature === null) {
        res.status(404).json({
          error: true,
          message: `Feature with id ${req.params.id} not found`
        });
        return;
      }

      try {
        const result = await state.features.deleteOne({ _id: objectId });
        res.json({
          error: false,
          deleted: result.deletedCount === 1
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }

    });

  state.app.post(
    "/features/queue",
    requireManageFeatures,
    async (req: JwtRequest, res: Response) => {
      const maybe = QueueRequestBody.decode(req.body);
      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const ids = maybe.right.scene_ids;
      const objectIDs = ids.map((id: string) => new ObjectId(id));
      const scenes = await state.scenes.find({ "_id": { "$in": objectIDs } }).toArray();
      if (scenes.length !== objectIDs.length) {
        res.status(400).json({
          error: true,
          message: "At least one of the scene IDs does not correspond to a valid scene",
        });
        return;
      }

      // Note that this method fully replaces the queue, rather than extending it. This
      // behavior makes it convenient to implement drag-n-drop reordering in the
      // queue management UI.
      const result = await state.featureQueue.updateOne(
        { queue: true },
        { "$set": { scene_ids: objectIDs } },
      );

      if (result.modifiedCount === 1) {
        res.json({
          error: false,
          message: "Queue updated successfully"
        });
      } else {
        res.status(500).json({
          error: true,
          message: "Error updating queue in database"
        });
      }
    });

}
