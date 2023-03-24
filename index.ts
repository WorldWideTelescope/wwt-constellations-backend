import express, { ErrorRequestHandler, Express, Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import cors from "cors";
import { expressjwt, GetVerificationKey, Request as JwtRequest } from "express-jwt";
import { parseXmlFromUrl, snakeToPascal } from "./util";
import { JSDOM } from 'jsdom';
import jwksClient from "jwks-rsa";
import { isScene, isSceneSettings } from './types';
import { MongoClient, ObjectId, WithId, Document } from 'mongodb';
import { create } from "xmlbuilder2";

dotenv.config();

const app: Express = express();
app.use(cors());

// The Azure environment tells us which port to listen on:
const portstr = process.env.PORT ?? "7000";
const port = parseInt(portstr, 10);

const jsonBodyParser = bodyParser.json();
app.use(jsonBodyParser);

// Set up authentication

const kcBaseUrl = (() => {
  let b = process.env.KEYCLOAK_URL ?? "http://localhost:8080/";

  if (!b.endsWith("/")) {
    b += "/";
  }

  return b;
})();

const kcRealm = "constellations";

const requireAuth = expressjwt({
  secret: jwksClient.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `${kcBaseUrl}realms/${kcRealm}/protocol/openid-connect/certs`
  }) as GetVerificationKey,

  // can add `credentialsRequired: false` to make auth optional
  audience: "account",
  issuer: `${kcBaseUrl}realms/${kcRealm}`,
  algorithms: ['RS256']
});

const noAuthErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err.name === "UnauthorizedError") {
    res.status(401).json({
      error: true,
      message: "Invalid authentication token"
    });
  } else {
    next(err);
  }
};

// Prepare to connect to CosmosDB. We can't actually do anything useful with our
// database variables until we connect to the DB, though, and that happens
// asynchronously at the end of this file.

const connstr = process.env.AZURE_COSMOS_CONNECTIONSTRING ?? process.env.MONGO_CONNECTION_STRING;
if (connstr === undefined) {
  throw new Error("must define $AZURE_COSMOS_CONNECTIONSTRING or $MONGO_CONNECTION_STRING");
}

const cosmos = new MongoClient(connstr);
const database = cosmos.db("constellations-db");
const sceneCollection = database.collection("scenes");
const imageCollection = database.collection("images");

let data: Document = new JSDOM().window.document;
(async () => {
  const dataURL = "http://www.worldwidetelescope.org/wwtweb/catalog.aspx?W=astrophoto";
  data = await parseXmlFromUrl(dataURL);
})();

app.get('/', (_req: Request, res: Response) => {
  res.send('Express + TypeScript Server');
});

app.get('/images', async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.size as string);
  const toSkip = (page - 1) * size;
  const items: WithId<Document>[] = await imageCollection.find().skip(toSkip).limit(size).toArray();

  const root = create().ele("Folder");
  root.att("Browseable", "True");
  root.att("Group", "Explorer");
  root.att("Searchable", "True");

  items.forEach(item => {
    const iset = root.ele("ImageSet");
    Object.entries(item["imageset"]).forEach(([key, value]) => {
      iset.att(key, String(value));
    });

    Object.entries(item).forEach(([key, value]) => {
      if (key === "imageset") {
        return;
      }
      if (key === "_id") {
        value = (value as ObjectId).toString();
      }
      key = snakeToPascal(key);
      const el = iset.ele(key);
      el.txt(value);
    });

  });

  root.end({ prettyPrint: true });

  res.type("application/xml")
  res.send(root.toString());
});

app.get('/data', async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.limit as string);
  const start = (page - 1) * size;
  const items = [...data.querySelectorAll("Place")].slice(start, start + size);
  const folder = data.createElement("Folder");
  items.forEach(item => {
    folder.appendChild(item.cloneNode(true))
  });
  res.type('application/xml');
  res.send(folder.outerHTML);
});

app.post('/scenes/create', requireAuth, noAuthErrorHandler, async (req: JwtRequest, res: Response) => {
  const body = req.body;
  let scene = body.scene;

  if (!isScene(scene)) {
    res.statusCode = 400;
    res.json({
      created: false,
      message: "Malformed scene JSON"
    });
    return;
  }

  console.log("auth info", req.auth);

  console.log("About to insert item");
  sceneCollection.insertOne(scene).then((result) => {
    res.json({
      created: result.acknowledged,
      id: result.insertedId
    });
  });


});

app.post('/scenes/:id::action', requireAuth, noAuthErrorHandler, async (req: JwtRequest, res: Response) => {
  console.log("???");
  const body = req.body;
  const settings = body.updates;
  const id = req.params.id;

  if (req.params.action !== "update") {
    console.log(`No such supported action ${req.params.action}`);
  }

  if (!isSceneSettings(settings)) {
    res.statusCode = 400;
    res.json({
      updated: false,
      message: "At least one of your fields is not a valid scene field"
    });
    return;
  }

  console.log("auth info", req.auth);

  sceneCollection.findOneAndUpdate(
    { "_id": new ObjectId(id) },
    { $set: settings },
    { returnDocument: "after" } // Return the modified document
  ).then((result) => {
    console.log(result);
    const updated = (result.lastErrorObject) ? result.lastErrorObject['updatedExisting'] : false;
    res.json({
      updated,
      scene: result.value
    });
  });
});

app.get('/scenes/:sceneID', async (req: Request, res: Response) => {
  const result = await sceneCollection.findOne({ "_id": new ObjectId(req.params.sceneID) });
  res.json(result);
});

// Let's get started!

(async () => {
  await cosmos.connect();
  console.log("Connected to database!");

  app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at https://localhost:${port}`);
  });
})();
