import { handle } from '@astrojs/cloudflare/handler';

import { removeExpiredActivity } from './lib/data-retention';
import { applyProtectedAccessPolicy } from './lib/protected-access';
import { checkQuizEligibility } from './lib/quiz-eligibility';
import { POST as fingerprintPost } from './pages/api/fingerprint';

const QUIZ_ELIGIBILITY_PATH = '/api/internal/quiz-eligibility';

export default {
	async fetch(request, env, context) {
		const pathname = new URL(request.url).pathname;
		// This inert POST must also accept bodyless requests before Astro's Origin check.
		if (pathname === '/api/fingerprint' && request.method === 'POST') return fingerprintPost();
		if (pathname === QUIZ_ELIGIBILITY_PATH) {
			return checkQuizEligibility(request, env);
		}
		return applyProtectedAccessPolicy(request, env.SESSION_SECRET, () => handle(request, env, context));
	},

	async scheduled(controller, env) {
		await removeExpiredActivity(env.DB, controller.scheduledTime);
	},
} satisfies ExportedHandler<Env>;
