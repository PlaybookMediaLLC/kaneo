export function kebab(value) {
  return value
    .replace(/Quills/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function pascal(value) {
  return value
    .replace(/Quills/g, "")
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export function operationNames(operationId) {
  const value = operationId.replace("Quills", "");
  return {
    name: value[0].toLowerCase() + value.slice(1),
    pascal: value[0].toUpperCase() + value.slice(1),
    file: kebab(operationId),
  };
}
