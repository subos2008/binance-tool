const assert = require("assert");

function fall_over(string) {
  console.log(`ERROR: ` + string);
  process.exit(1);
}

module.exports = function() {
  const fs = require("fs");
  const Handlebars = require("handlebars");

  const template_string = fs.readFileSync(
    `${__dirname}/template.handlebars`,
    "utf8"
  );
  const template = Handlebars.compile(template_string);

  const namespace = process.env.KUBECTL_NAMESPACE;
  const container_name = "binance-tool";
  const docker_image = process.env.DOCKER_REGISTRY;
  const trade_id = process.env.TRADE_ID;

  assert(trade_id);
  assert(docker_image);
  assert(namespace);

  const job_name = `binance-tool-trade-id-${trade_id}`;
  const contents = template({
    docker_image,
    container_name,
    trade_id
  });

  const output_dir = `deployed-trades`;
  const execSync = require("child_process").execSync;
  code = execSync(`mkdir -p ${output_dir}`);
  const output_filename = `${output_dir}/${job_name}.yaml`;

  fs.writeFileSync(output_filename, contents, err => {
    if (err) {
      return console.error(`Autsch! Failed to store template: ${err.message}.`);
    }
    console.log(`Saved ${output_filename}`);
  });

  code = execSync(
    `kubectl apply --namespace ${namespace} -f ${output_filename}`
  );
};
