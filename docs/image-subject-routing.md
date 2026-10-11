# Image subject routing

Bare commands such as “Create an image” and “Create a image” use the current chat’s recent substantive discussion. Generic image-command messages, generated-image turns and failed-image notices do not replace that subject. A bare request without usable discussion asks for a subject before the provider is called.

“Create Liberia map”, “Show me the flag of Liberia” and “I want to see Liberia flag” route to image generation. Explanations about maps or flags remain text answers. New image request bubbles use the original wording; older duplicated action prefixes are cleaned for display without modifying saved message contents.

This is a subject-routing fix, not a guarantee of image-model accuracy. AI-generated maps and flags must be checked before use as authoritative geography or official references. Image context remains bounded to recent discussion in the same chat.
