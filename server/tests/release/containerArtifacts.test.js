const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const serverRoot = path.resolve(__dirname, "..", "..");
const repositoryRoot =
  process.env.RELEASE_CONTRACT_ROOT || path.resolve(serverRoot, "..");

function readRepositoryFile(relativePath) {
  let filename = path.join(repositoryRoot, relativePath);
  if (!existsSync(filename) && relativePath.startsWith("server/")) {
    filename = path.join(serverRoot, relativePath.slice("server/".length));
  }
  return readFileSync(filename, "utf8").replace(/\r\n/g, "\n");
}

function serviceBlock(compose, name, nextName) {
  const start = compose.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} service`);

  const end = nextName ? compose.indexOf(`  ${nextName}:\n`, start + 1) : -1;
  return compose.slice(start, end === -1 ? compose.length : end);
}

test("Dockerfile uses reproducible Node 24 dependencies and a non-root runtime", () => {
  const dockerfile = readRepositoryFile("server/Dockerfile");

  assert.match(dockerfile, /^FROM node:24-bookworm-slim\s*$/m);
  assert.match(dockerfile, /^WORKDIR \/app\s*$/m);
  assert.match(
    dockerfile,
    /^COPY --chown=node:node package\.json package-lock\.json \.\/$/m,
  );
  assert.match(dockerfile, /^RUN npm ci\s*$/m);
  assert.match(dockerfile, /^COPY --chown=node:node \. \.\s*$/m);
  assert.match(dockerfile, /^USER node\s*$/m);
  assert.match(dockerfile, /^EXPOSE 5000\s*$/m);
  assert.match(dockerfile, /^CMD \["npm", "start"\]\s*$/m);

  const userLine = dockerfile.indexOf("USER node");
  assert.ok(userLine > dockerfile.indexOf("RUN npm ci"));
  assert.ok(userLine < dockerfile.indexOf('CMD ["npm", "start"]'));
  assert.doesNotMatch(dockerfile, /\b(latest|sudo|apt-get)\b/i);
});

test("Docker build context excludes secrets and generated content but retains the template", () => {
  const dockerignore = readRepositoryFile("server/.dockerignore");
  const entries = dockerignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const required of [
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules",
    "coverage",
    "dist",
    ".git",
  ]) {
    assert.ok(entries.includes(required), `missing .dockerignore rule ${required}`);
  }

  assert.ok(
    entries.indexOf("!.env.example") > entries.indexOf(".env.*"),
    "the safe template allow-rule must follow the environment wildcard",
  );
});

test("Compose preserves the Gate-1 Mongo replica-set services exactly", () => {
  const compose = readRepositoryFile("docker-compose.yml");
  const expectedGateOne = `services:
  mongo:
    image: mongo:8
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' | grep 1"]
      interval: 5s
      timeout: 5s
      retries: 30
  mongo-init:
    image: mongo:8
    depends_on:
      mongo:
        condition: service_healthy
    volumes:
      - ./docker/mongo-init.sh:/mongo-init.sh:ro
    entrypoint: ["sh", "/mongo-init.sh"]
`;

  assert.ok(
    compose.startsWith(expectedGateOne),
    "mongo and mongo-init must remain byte-for-byte equivalent to Gate 1",
  );
});

test("Compose API uses the server image, optional local env, rs0 development DB, and mongo-init gate", () => {
  const compose = readRepositoryFile("docker-compose.yml");
  const api = serviceBlock(compose, "api", "server-test");
  const developmentUri =
    "mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0";

  assert.match(api, /build:\n\s+context: \.\/server\n\s+dockerfile: Dockerfile/);
  assert.match(api, /image: vehicle-service-booking-server:local/);
  assert.match(api, /ports:\n\s+- "5000:5000"/);
  assert.match(
    api,
    /env_file:\n\s+- path: \.\/server\/\.env\n\s+required: false/,
  );
  assert.match(api, /^\s+PORT: "5000"\s*$/m);
  assert.match(api, new RegExp(`MONGO_URI: ${developmentUri.replace(/[?]/g, "\\?")}`));
  assert.match(
    api,
    /depends_on:\n\s+mongo-init:\n\s+condition: service_completed_successfully/,
  );
  assert.doesNotMatch(api, /vehicle_service_booking_test/);
});

test("Compose server-test uses only identical guarded rs0 test URIs and the external command", () => {
  const compose = readRepositoryFile("docker-compose.yml");
  const serverTest = serviceBlock(compose, "server-test");
  const testUri =
    "mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0";

  assert.match(serverTest, /build:\n\s+context: \.\/server\n\s+dockerfile: Dockerfile/);
  assert.match(serverTest, /image: vehicle-service-booking-server:local/);
  assert.match(
    serverTest,
    /depends_on:\n\s+mongo-init:\n\s+condition: service_completed_successfully/,
  );
  assert.match(
    serverTest,
    /command: \["npm", "run", "test:all:external"\]/,
  );

  for (const name of ["MONGO_URI_TEST", "MONGO_URI", "TEST_DATABASE_URI"]) {
    assert.match(
      serverTest,
      new RegExp(`^\\s+${name}: ${testUri.replace(/[?]/g, "\\?")}\\s*$`, "m"),
    );
  }
  assert.equal(
    [...serverTest.matchAll(/mongodb:\/\/mongo:27017\/[^\s]+/g)].map(
      ([value]) => value,
    ).filter((value) => value === testUri).length,
    3,
  );
  assert.match(serverTest, /RELEASE_CONTRACT_ROOT: \/release-contract/);
  assert.match(
    serverTest,
    /\.\/docker-compose\.yml:\/release-contract\/docker-compose\.yml:ro/,
  );
  assert.match(
    serverTest,
    /\.\/\.github\/workflows\/ci\.yml:\/release-contract\/\.github\/workflows\/ci\.yml:ro/,
  );
  assert.match(
    serverTest,
    /\.\/server\/Dockerfile:\/release-contract\/server\/Dockerfile:ro/,
  );
  assert.match(
    serverTest,
    /\.\/server\/\.dockerignore:\/release-contract\/server\/\.dockerignore:ro/,
  );
  assert.doesNotMatch(serverTest, /GMAIL|PASSWORD|JWT|SECRET|env_file/i);
  assert.doesNotMatch(serverTest, /vehicle_service_booking\?(?![^\s]*_test)/);
});
