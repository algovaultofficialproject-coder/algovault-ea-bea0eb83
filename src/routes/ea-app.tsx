import { createFileRoute, redirect } from "@tanstack/react-router";

// Older Android builds open /ea-app; send them to the current /android app.
export const Route = createFileRoute("/ea-app")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/android${location.searchStr ?? ""}`, replace: true });
  },
});
