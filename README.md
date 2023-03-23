# WorldWide Telescope Constellations: The Backend

This is an ExpressJS web server that communicates with a [MongoDB] storage
backend (location specified with the `MONGO_CONNECTION_STRING` environement
variable) and (soon!) a [Keycloak server][keycloak].

[keycloak]: https://www.keycloak.org/
[MongoDB]: https://www.mongodb.com/

The [WWT Constellations frontend server][frontend] communicates with this
backend to create the WWT Constellations app experience.

[frontend]: https://github.com/WorldWideTelescope/wwt-constellations-frontend/


## Setup

Make sure to install the dependencies:

```bash
yarn install
```


## Production

Build the application for production:

```bash
yarn build
```

Start the server (defaulting to run on http://localhost:7000):

```bash
yarn start
```


## Configuration

Environment variables:

- `PORT` to set the port for the server to listen on; default is 7000.
- `MONGO_CONNECTION_STRING` to set the path to MongoDB server; must be specified.
  - `AZURE_COSMOS_CONNECTIONSTRING` has the same effect and higher priority


## MongoDB Development Server

Setting up a MongoDB development server is straightforward:

```
docker create \
  --name cx-mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=root \
  -e MONGO_INITDB_ROOT_PASSWORD=mypass \
  mongo:latest

docker start cx-mongodb

export MONGO_CONNECTION_STRING='mongodb://root:mypass@localhost:27017/'
```

Although there is a [Microsoft Cosmos/Mongo emulator docker image][ms-mongo]
that might mirror what we run in production more closely, [it is broken right
now][1] (March 2023).

[ms-mongo]: https://learn.microsoft.com/en-us/azure/cosmos-db/docker-emulator-linux
[1]: https://github.com/MicrosoftDocs/azure-docs/issues/94775
