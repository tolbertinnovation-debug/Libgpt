# Illustrated cooking lessons

Open **Cooking**, select a dish (or name another), choose servings and experience level, and enter dietary restrictions, allergies or equipment preferences. The written lesson includes quantities, ordered steps, optional preparation/cooking times, observable cues and preparation notes.

When image creation is available, **Create teaching pictures with the recipe** is selected by default. The lesson is shown first; up to three illustrations are then generated sequentially: ingredients, a middle cooking step and the finished dish. A **Show this stage** control can request any other step. Image prompts use the dish, ingredients and exact selected recipe step, rather than a generic food description. Each completed picture has a caption and download link.

The progress panel offers **Stop pictures**. Closing Cooking or switching tabs also cancels pending requests. Successful pictures and the written lesson remain available; failure stops the automatic batch and shows the provider's useful error. **Create missing lesson pictures** retries unfinished default stages without regenerating completed pictures. Starting a new recipe replaces the current lesson after cancelling the old work. Recipes and pictures remain in memory across tabs during the session.

Images use the existing `/api/image` service, access gate and image budget. Automatic generation uses medium-quality landscape illustrations; no additional provider credentials are required. The checkbox can be turned off, and is disabled with an explanation when image generation is unavailable. A recipe remains usable without any pictures.

**Download illustrated lesson** produces a self-contained HTML file with all completed images and text, suitable for browser viewing or printing to PDF. **Keep this recipe** saves the recipe text, cooking cues, preparation notes and a small representative picture in the journal. Existing backups preserve that thumbnail. Full illustration sets are kept in the downloaded HTML; they are not stored in the journal or guaranteed after reload.

Pictures are labelled AI-generated and may contain visual mistakes. They cannot establish safe doneness. Written instructions and authoritative food-safety guidance take priority. Dietary and preparation instructions guide the model; they do not guarantee accuracy or allergen safety.

Validation uses mocked provider responses to check grounded stage prompts, sequential requests, reuse of completed images, cancellation, partial failures, image validation and escaped HTML exports. Browser checks cover automatic pictures, an additional step, tabs, journal saving, the illustrated download, cancellation and text-only lessons. Actual image quality and recipe accuracy require live-provider review.
