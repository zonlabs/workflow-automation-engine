declare module "express" {
  import type { Request, Response, NextFunction, Application } from "express-serve-static-core";
  interface ExpressStatic {
    (): Application;
    json: (options?: any) => any;
  }
  const e: ExpressStatic;
  export = e;
  export type { Request, Response, NextFunction, Application };
}
