import { Application, Sub, Cmd, CmdSpec, makeApi, SubSpec } from "../src/redux-ports";
import { AnyAction } from "redux";

describe("Application", () => {
  it("Contains an empty object for state before run", () => {
    const application = new Application(
      () => {
        throw new Error("Init not expected to be called");
      },
      () => {
        throw new Error("Subscriptions not expected to be called");
      },
      () => {
        throw new Error("Update not expected to be called");
      },
      {},
    );
    expect(application.store.getState()).toEqual({});
  });

  it("Initializes state from flags", () => {
    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => Sub.None<AnyAction>(),
      () => {
        throw new Error("Update not expected to be called");
      },
      {},
    );
    application.run(42);
    expect(application.store.getState()).toEqual(42);
  });

  it("Calls the initial cmd", () => {
    const apiSpec = {
      log: CmdSpec<string>(),
    };

    const api = makeApi(apiSpec);

    const application = new Application(
      (n: number) => [n, api.log<AnyAction>("hi")],
      () => Sub.None<AnyAction>(),
      () => {
        throw new Error("Update not expected to be called");
      },
      apiSpec,
    );

    let msg = "";

    application.ports.log.subscribe(m => (msg = m));

    application.run(12);
    expect(application.store.getState()).toEqual(12);
    expect(msg).toEqual("hi");
  });

  it("Throws an error when dispatch called before run", () => {
    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => Sub.None<AnyAction>(),
      () => {
        throw new Error("Update not expected to be called");
      },
      {},
    );

    expect(() => application.store.dispatch({ type: "Foo" })).toThrow(
      new Error("application.run() must be called before application.store.dispatch()"),
    );
  });

  it("Updates the state accordingly with dispatch", () => {
    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => Sub.None<AnyAction>(),
      (model, msg) => [
        msg.type === "inc" ? model + 1 : msg.type === "dec" ? model - 1 : model,
        Cmd.None(),
      ],
      {},
    );

    application.run(12);
    application.store.dispatch({ type: "inc" });
    expect(application.store.getState()).toEqual(13);
    application.store.dispatch({ type: "dec" });
    application.store.dispatch({ type: "dec" });
    application.store.dispatch({ type: "dec" });
    expect(application.store.getState()).toEqual(10);
    application.store.dispatch({ type: "foo" });
    expect(application.store.getState()).toEqual(10);
  });

  it("Active Subs are processed", () => {
    const apiSpec = {
      numberReceived: SubSpec<number>(),
    };

    const api = makeApi(apiSpec);

    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => api.numberReceived(x => ({ type: "add", number: x })),
      (model, msg) => [msg.type === "add" ? model + msg.number : model, Cmd.None()],
      apiSpec,
    );

    application.run(12);
    application.ports.numberReceived.send(10);
    expect(application.store.getState()).toEqual(22);
  });

  it("Non active Subs are skipped", () => {
    const apiSpec = {
      numberReceived: SubSpec<number>(),
    };

    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => Sub.None<AnyAction>(),
      (model, msg) => [msg.type === "add" ? model + msg.number : model, Cmd.None()],
      apiSpec,
    );

    application.run(12);
    application.ports.numberReceived.send(10);
    expect(application.store.getState()).toEqual(12);
  });

  it("Batch Subs are processed", () => {
    const apiSpec = {
      numberReceived: SubSpec<number>(),
    };

    const api = makeApi(apiSpec);

    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () =>
        Sub.Batch(
          api.numberReceived(x => ({ type: "add", number: x })),
          api.numberReceived(x => ({ type: "mul", number: x })),
        ),
      (model, msg) => [
        msg.type === "add" ? model + msg.number : msg.type === "mul" ? model * msg.number : model,
        Cmd.None(),
      ],
      apiSpec,
    );

    application.run(12);
    application.ports.numberReceived.send(10);
    expect(application.store.getState()).toEqual(220);
  });

  it("Batch cmds are processed", () => {
    const apiSpec = {
      log: CmdSpec<string>(),
    };

    const api = makeApi(apiSpec);

    const application = new Application(
      (n: number) => [n, Cmd.None<AnyAction>()],
      () => Sub.None<AnyAction>(),
      (model, msg) => [
        msg.type === "inc" ? model + 1 : msg.type === "dec" ? model - 1 : model,
        msg.type === "msg" ? Cmd.Batch(api.log("yo"), Cmd.Msg({ type: "inc" })) : Cmd.None(),
      ],
      apiSpec,
    );

    let msg = "";

    application.ports.log.subscribe(m => (msg = m));

    application.run(12);
    application.store.dispatch({ type: "msg" });
    expect(msg).toEqual("yo");
    expect(application.store.getState()).toEqual(13);
  });

  it("Cmd responses are processed", () => {
    const apiSpec = {
      log: CmdSpec<string, number>(),
    };

    const api = makeApi(apiSpec);

    const application = new Application(
      (n: number) => [n, api.log<AnyAction>("hi", x => ({ type: "mul", number: x }))],
      () => Sub.None<AnyAction>(),
      (model, msg) => [
        msg.type === "add" ? model + msg.number : msg.type === "mul" ? model * msg.number : model,
        Cmd.None(),
      ],
      apiSpec,
    );

    let msg = "";

    application.ports.log.subscribe((m, next) => {
      msg = m;
      next(2);
    });

    application.run(12);
    expect(msg).toEqual("hi");
    expect(application.store.getState()).toEqual(24);
  });
});
