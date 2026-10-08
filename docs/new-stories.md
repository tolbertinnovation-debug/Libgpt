# Generate another stori

Open **Tell me a Stori** or the Library's **Stori** tab. Choose a kind, theme, and optional subject, then press **Generate a new stori**.

After a story appears, **Generate another stori** starts a fresh request immediately, including before a branching story has finished. Your kind, theme, and subject stay selected when moving between Library tabs. Choose a branch to finish the current story and use **Keep this in my journal** if you want to save it before generating another.

The app remembers the titles and the first 600 characters of the latest 16 stories in this browser. Each request sends those excerpts for comparison, asks for a fresh plot and title, and uses varied inspiration for fictional folktales. The server checks repeated titles and similar openings, retries once, and returns an error rather than displaying a detected repeat if both attempts repeat. The retry uses another OpenAI request.

Historical anecdotes keep factuality instructions; their choices select the recorded detail to explain next. Original folktales are labelled as fiction inspired by West African storytelling, without inventing traditional attributions.

Fast taps cannot start overlapping story requests. If generation fails, the current story remains available with an error message. Changing Library tabs does not replace another tab's content with a late story response.

Repeat detection is limited to recent stories on this browser and title/opening similarity. It cannot guarantee that every idea is globally unique or recognise every rewritten plot. Clearing browser storage or using another device starts a new recent-story history. If storage is blocked, memory still works for the current session.

Tests use simulated API answers and panel fixtures. Real OpenAI story generation and the production deployment need verification on the configured host.
