// Bun bundles an imported PNG and gives its URL.
declare module "*.png" {
  const url: string;
  export default url;
}
