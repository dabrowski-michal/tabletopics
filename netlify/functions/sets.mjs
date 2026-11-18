import { getStore } from '@netlify/blobs';
import { createSetsHandler } from '../../server/sets-core.mjs';

/* Question sets live in Netlify Blobs (the site's built-in key-value store).
   The site password comes from the SITE_PASSWORD environment variable
   (Netlify → Site configuration → Environment variables). */

const store = () => getStore({ name: 'table-topics', consistency: 'strong' });

const handle = createSetsHandler({
    password: () => process.env.SITE_PASSWORD,
    loadDoc: () => store().get('sets', { type: 'json' }),
    saveDoc: doc => store().setJSON('sets', doc)
});

export default request => handle(request);

export const config = { path: '/api/sets' };
