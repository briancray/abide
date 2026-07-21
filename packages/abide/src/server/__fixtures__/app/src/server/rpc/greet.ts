import { GET } from "../../../../../GET.ts";

export default GET(({ name }: { name: string }) => `hi ${name}`);
