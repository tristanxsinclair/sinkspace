import { test } from 'node:test';
import { scenarios } from '../runtime/eval-scenarios.js';
for(const scenario of scenarios)test(scenario.name,scenario.check);
