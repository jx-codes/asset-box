# Asset Box

Asset Box is a simple product. It allows agents to upload single page HTML
assets to a cloudflare R2 bucket behind a worker and allows a user to view these
assets. 

- Site and uploads must be password protected
- Single user, password retry attempts throttled, password set via secret
- Keep an index page, agent must include short blurb and title for what it is
- Allow user to define tags and guidance for the agent on when to use each. 
- CLI tool that would allow the agent to upload the HTML assets
- Should probably hash assets somehow to prevent duplicates
- Versions? Might cause the agent to spend time perfecting instead of just
  getting it done. Not for first version
- Use some self describing API method, Hono for the router
- Live updates so I don't have to refresh. 
- Small toast at the bottom right when new items come in. 
- Main page could honestly be a sort of email view. 
- Must be mobile first but scale gracefully to desktop size
- Again single user (myself) only for now. If useful might expand to sign ups
  but out of scope for now. 




