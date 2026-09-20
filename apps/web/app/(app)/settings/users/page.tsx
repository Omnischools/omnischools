import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { USER_ADMIN_ROLES } from "@/lib/access";
import { loadSchoolUsers } from "@/lib/users/manage-data";
import { UserManagementTable } from "@/components/settings/user-management-table";
import { BackLink } from "@/components/ui/back-link";

/**
 * INCR-35 (L2b) · Settings › Users & access. Manage the login lifecycle (block / reactivate / reset) for
 * everyone at the school. Double-gated: `assertAnyRole(USER_ADMIN_ROLES)` here (are you a manager), and
 * per-row `canManageTarget` in the action + table (do you outrank THIS target). Distinct from /staff,
 * which mints staff + assigns roles.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Users & access" };

export default async function UsersPage() {
  const { user, school } = await requireSchool();
  await assertAnyRole(USER_ADMIN_ROLES);
  const users = await loadSchoolUsers(school.id);

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings" label="Settings" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Users &amp; <em className="not-italic text-gold [font-style:italic]">access.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Block, reactivate, or reset a password for anyone at your school. You can only manage users
          below your own level.
        </p>
      </div>
      <UserManagementTable users={users} actor={{ id: user.id, roles: user.roles }} />
    </div>
  );
}
