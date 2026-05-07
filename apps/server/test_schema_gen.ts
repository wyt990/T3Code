import { Schema } from "effect";
import { toJsonSchemaObject } from "./src/git/Utils.ts";

const threadTitleSchema = Schema.Struct({
  title: Schema.String,
});

console.log("Thread Title Schema:");
console.log(JSON.stringify(toJsonSchemaObject(threadTitleSchema), null, 2));

const prContentSchema = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
});

console.log("\nPR Content Schema:");
console.log(JSON.stringify(toJsonSchemaObject(prContentSchema), null, 2));

const commitMessageSchema = Schema.Struct({
  subject: Schema.String,
  body: Schema.String,
  branch: Schema.String,
});

console.log("\nCommit Message Schema:");
console.log(JSON.stringify(toJsonSchemaObject(commitMessageSchema), null, 2));
