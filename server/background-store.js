import {createBuildJobStore} from './build-jobs.js';
const connectionString=process.env.RITUAL_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const buildJobStore=connectionString ? createBuildJobStore({connectionString}) : null;
