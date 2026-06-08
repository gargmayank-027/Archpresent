/**
 * app/project/[id]/page.tsx
 *
 * Smart redirect: takes the user to whichever step they're up to.
 * /project/abc → /project/abc/review  (if just uploaded)
 *             → /project/abc/moodboards (if analyzed)
 *             → /project/abc/export    (if styled)
 */

import { redirect } from "next/navigation";
import { projectStore } from "@/lib/store";

export default async function ProjectIndexPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await projectStore.get(params.id);

  if (!project) {
    redirect("/");
  }

  if (project.status === "created") {
    redirect(`/project/${params.id}/review`);
  } else if (project.status === "analyzed") {
    redirect(`/project/${params.id}/moodboards`);
  } else {
    redirect(`/project/${params.id}/export`);
  }
}
