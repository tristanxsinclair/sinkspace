import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { TaskSchema, ReceiptSchema, RunSchema, AgentDefinitionSchema, MemorySchema } from './contracts.js';
for(const [name,schema] of Object.entries({task:TaskSchema,receipt:ReceiptSchema,run:RunSchema,agent:AgentDefinitionSchema,memory:MemorySchema})) {
  await writeFile(new URL(`../agents/schemas/${name}.schema.json`,import.meta.url),JSON.stringify(z.toJSONSchema(schema),null,2)+'\n');
}
