function roleOf(user) {
  return String(user?.role || '').toUpperCase();
}
function isAdmin(user) {
  return roleOf(user) === 'ADMIN';
}
function canManageUsers(user) {
  return isAdmin(user);
}
function canExecuteCritical(user) {
  return ['ADMIN', 'DBA'].includes(roleOf(user));
}
function canExecuteSelect(user) {
  return ['ADMIN', 'DBA', 'OPERATOR'].includes(roleOf(user));
}
module.exports = { roleOf, isAdmin, canManageUsers, canExecuteCritical, canExecuteSelect };
