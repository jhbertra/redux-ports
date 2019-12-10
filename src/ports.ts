/*
 * API specifications
 */

export interface CmdSpec<a, b = undefined> {
  readonly type: 0;
}

export interface SubSpec<a> {
  readonly type: 1;
}

export function CmdSpec<a, b = undefined>(): CmdSpec<a, b> {
  return { type: 0 };
}

export function SubSpec<a>(): SubSpec<a> {
  return { type: 1 };
}

export interface ApiSpec {
  readonly [port: string]: CmdSpec<any, any> | SubSpec<any>;
}

/*
 * API interfaces (consumed within Applications)
 */

export interface RunCmd<msg> {
  readonly port: string;
  readonly data: any;
  handleResponse(response: any): msg;
}

export type Cmd<msg> =
  | { tag: "None" }
  | { tag: "Msg"; msg: msg }
  | { tag: "Run"; run: RunCmd<msg> }
  | { tag: "Batch"; cmds: Cmd<msg>[] };

export const Cmd = {
  None<msg>(): Cmd<msg> {
    return { tag: "None" };
  },
  Msg<msg>(msg: msg): Cmd<msg> {
    return { tag: "Msg", msg };
  },
  Run<msg>(run: RunCmd<msg>): Cmd<msg> {
    return { tag: "Run", run };
  },
  Batch<msg>(...cmds: Cmd<msg>[]): Cmd<msg> {
    return { tag: "Batch", cmds };
  },
};

export function makeCmd<a, msg>(data: a, port: string): Cmd<msg>;
export function makeCmd<a, msg, b>(
  data: a,
  port: string,
  handleResponse: (response: b) => msg,
): Cmd<msg>;

export function makeCmd<a, msg, b>(
  data: a,
  port: string,
  handleResponse?: (response: b) => msg,
): Cmd<msg> {
  return Cmd.Run({
    data,
    port,
    handleResponse:
      handleResponse ??
      (() => {
        throw new Error("No response expected to this port.");
      }),
  });
}

export type Sub<msg> =
  | { tag: "None" }
  | { tag: "Listen"; listen: ListenSub<msg> }
  | { tag: "Batch"; subs: Sub<msg>[] };

export const Sub = {
  None<msg>(): Sub<msg> {
    return { tag: "None" };
  },
  Listen<msg>(run: ListenSub<msg>): Sub<msg> {
    return { tag: "Listen", listen: run };
  },
  Batch<msg>(...subs: Sub<msg>[]): Sub<msg> {
    return { tag: "Batch", subs };
  },
};

export interface ListenSub<msg> {
  readonly port: string;
  handler<a>(data: a): msg;
}

export function makeSub<msg>(port: string, handler: <a>(data: a) => msg): Sub<msg> {
  return Sub.Listen({
    handler,
    port,
  });
}

export type Api<spec extends ApiSpec> = Readonly<
  {
    [port in keyof spec]: spec[port] extends CmdSpec<infer a, infer b>
      ? b extends undefined
        ? <msg>(data: a) => Cmd<msg>
        : <msg>(data: a, handleResponse: (response: b) => msg) => Cmd<msg>
      : spec[port] extends SubSpec<infer a>
      ? <msg>(handler: (data: a) => msg) => Sub<msg>
      : never;
  }
>;

export function makeApi<spec extends ApiSpec>(spec: spec): Api<spec> {
  const result = {} as any;

  for (const port in spec) {
    const portSpec = spec[port];
    result[port] =
      portSpec.type === 0
        ? (data: any, handleResponse: any) => makeCmd(data, port, handleResponse)
        : (handler: any) => makeSub(port as any, handler);
  }

  return result;
}

/*
 * API ports (implemented externally)
 */

export interface CmdPort<a, b> {
  subscribe(
    handler: b extends undefined
      ? (data: a) => void
      : (data: a, next: (response: b) => void) => void,
  ): void;
}

export interface SubPort<a> {
  send(data: a): void;
}

export type Ports<spec extends ApiSpec> = Readonly<
  {
    [port in keyof spec]: spec[port] extends CmdSpec<infer a, infer b>
      ? CmdPort<a, b>
      : spec[port] extends SubSpec<infer a>
      ? SubPort<a>
      : never;
  }
>;
