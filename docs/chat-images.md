# Create images in chat

Type a clear image request in chat, or use `/image` followed by a description, to generate directly without a popup. Direct generation uses natural style, square shape, and high detail. Progress appears in the conversation; the shared Stop button cancels the request.

For custom options, use **Create image** or **+ → Create an image**. Describe the subject, background, colors and any exact wording. Choose a style, square/landscape/portrait shape, and quality. The options popup closes immediately when creation starts. Create one image at a time using the app’s existing OpenAI API key.

The image appears inside the conversation with an AI-generated label. Tap it to enlarge, download the JPEG, or choose **Create another** to reopen the description and options. This creates a new image from text; it does not edit an uploaded photo. Photo questions remain available through **+ → Photos**.

Generated JPEGs and their descriptions stay with saved conversations and portable backups. Device storage and the existing 8 MB backup limit still apply. A failed storage write shows the existing warning; download the image before closing the page if it could not be saved.

## Deployment settings

- Set **ENABLE_IMAGES=true** for Production and redeploy.
- The default model is **gpt-image-2.5-flare**. Retired DALL·E settings are replaced with that default. **OPENAI_IMAGE_MODEL** can pin a permitted GPT Image model.
- The API key must have access to the selected image model. The app reports provider errors rather than claiming success or silently changing models.
- The existing access code, request rate limit and shared hourly image budget also protect chat images. On Vercel an access code is required.
- Images, Album and build pictures share the same process-local budget. This is not a global distributed spending limit on serverless hosting; set OpenAI project budgets/limits independently.
- Each click requests one image with no automatic retry. Cancel stops the browser/server request; if the provider has already started, credits may still be used.
- Images are delivered as compressed JPEGs to fit phone bandwidth and the hosting response limit. Size choices are 1024×1024, 1536×1024 and 1024×1536.

Official schema: https://developers.openai.com/api/reference/resources/images/methods/generate

Check important text and factual details in generated images. No feature can guarantee every result is correct.
